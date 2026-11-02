'use strict';
// Fix for servers that send an incomplete certificate chain (Alaska's elections site sends GlobalSign's
// 2018 intermediate, but its certificate was issued by the 2025 one). Browsers handle this with "AIA
// fetching": the site certificate names the URL of its issuer's certificate. We do the same:
//   1. read the site's certificate (verification off for this read only; no data is exchanged or used),
//   2. download the issuer certificate from the URL it names (Authority Information Access),
//   3. accept it only if it is a CA certificate signed by one of Node's built-in trusted roots,
//   4. make the real request with full verification, trusting the built-in roots plus that intermediate.
// Verification is never turned off for the request itself, and hostname checking stays on.
const tls = require('tls');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { X509Certificate } = require('crypto');

const CACHE_MS = 12 * 3600 * 1000;
const cache = new Map(); // host -> { pems, at }

function readLeaf(host, port = 443, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: /^[\d.]+$/.test(host) ? undefined : host, rejectUnauthorized: false }, () => {
      const c = sock.getPeerCertificate(true);
      sock.end();
      if (!c || !c.raw) return reject(new Error('no certificate presented'));
      resolve(new X509Certificate(c.raw));
    });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error('timed out reading certificate')); });
    sock.on('error', reject);
  });
}

function aiaIssuerUrls(cert) {
  return String(cert.infoAccess || '').split('\n').map((l) => /CA Issuers - URI:(\S+)/i.exec(l)).filter(Boolean).map((m) => m[1]);
}

function download(url, maxBytes = 64 * 1024, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'ElectionNightDashboard/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, maxBytes, timeoutMs)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} fetching issuer certificate`)); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(); reject(new Error('issuer certificate too large')); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timed out fetching issuer certificate')));
    req.on('error', reject);
  });
}

// Is `cert` a CA certificate signed by one of `roots` (X509Certificate[])?
function signedByRoot(cert, roots) {
  if (!cert.ca) return false;
  return roots.some((r) => { try { return cert.checkIssued(r) && cert.verify(r.publicKey); } catch { return false; } });
}

// Intermediates (PEM) for `host`, found via AIA and verified against `rootPems`. Follows up to 3 levels.
async function intermediatesFor(host, { port = 443, rootPems = tls.rootCertificates } = {}) {
  const hit = cache.get(`${host}:${port}`);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pems;
  const roots = rootPems.map((p) => new X509Certificate(p));
  const chain = [];
  let cert = await readLeaf(host, port);
  for (let depth = 0; depth < 3; depth++) {
    const urls = aiaIssuerUrls(cert);
    if (!urls.length) throw new Error('certificate names no issuer URL (AIA); cannot complete the chain');
    let issuer = null;
    for (const u of urls) {
      try { const c = new X509Certificate(await download(u)); if (cert.checkIssued(c) && cert.verify(c.publicKey)) { issuer = c; break; } } catch { /* try next URL */ }
    }
    if (!issuer) throw new Error('could not download a valid issuer certificate from the AIA URL');
    if (!issuer.ca) throw new Error('downloaded issuer is not a CA certificate');
    chain.push(issuer);
    if (signedByRoot(issuer, roots)) {
      const pems = chain.map((c) => c.toString());
      cache.set(`${host}:${port}`, { pems, at: Date.now() });
      return pems;
    }
    if (roots.some((r) => r.fingerprint256 === issuer.fingerprint256)) break;
    cert = issuer; // go one level up
  }
  throw new Error('downloaded issuer does not chain to a trusted root; refusing it');
}

// GET over HTTPS with an explicit CA list (full verification), following redirects and decompressing.
function getWithCa(url, { ca, headers = {}, timeoutMs = 30000, redirects = 3, servername } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, ...(servername ? { servername } : {}), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElectionNightDashboard/1.0)', 'Accept-Encoding': 'gzip, deflate, br', ...headers }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); return resolve(getWithCa(new URL(res.headers.location, url).href, { ca, headers, timeoutMs, redirects: redirects - 1 }));
      }
      const enc = res.headers['content-encoding'];
      const body = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      body.on('data', (c) => chunks.push(c));
      body.on('error', reject);
      body.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) { const e = new Error(`HTTP ${res.statusCode} from ${new URL(url).host}`); e.status = res.statusCode; return reject(e); }
        resolve(text);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${new URL(url).host}`)));
    req.on('error', reject);
  });
}

const CERT_ERRORS = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|unable to verify the first certificate|unable to get local issuer/i;
const isChainError = (e) => CERT_ERRORS.test(`${e && e.code} ${e && e.message} ${e && e.cause && e.cause.code} ${e && e.cause && e.cause.message}`);

// Fetch text; if the server's chain is incomplete, complete it via AIA and retry with full verification.
async function fetchTextCompletingChain(url, plainFetch, { rootPems = tls.rootCertificates, headers } = {}) {
  try { return await plainFetch(url); } catch (e) {
    if (!isChainError(e)) throw e;
    const u = new URL(url);
    const extra = await intermediatesFor(u.hostname, { port: Number(u.port) || 443, rootPems });
    return getWithCa(url, { ca: [...rootPems, ...extra], headers });
  }
}

module.exports = { fetchTextCompletingChain, intermediatesFor, getWithCa, isChainError, aiaIssuerUrls, _cache: cache };
