'use strict';
// Incomplete-chain handling (Alaska): a local HTTPS server sends only its leaf certificate, whose AIA
// URL points at the intermediate. Requires the openssl CLI; skipped if it's missing.
//   node tools/test-aia.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const aia = require('../lib/aia');

try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { console.log('test-aia: skipped (no openssl)'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-'));
const f = (n) => path.join(dir, n);
const ssl = (...a) => execFileSync('openssl', a, { stdio: 'pipe' });
const ext = (name, body) => { fs.writeFileSync(f(name), body); return f(name); };

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

(async () => {
  // Serves the intermediate (DER) at /inter.der, and a bogus self-signed CA at /bogus.der.
  const certs = {};
  const aiaSrv = http.createServer((req, res) => { const b = certs[req.url]; if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200); res.end(b); });
  await new Promise((r) => aiaSrv.listen(0, '127.0.0.1', r));
  const aiaPort = aiaSrv.address().port;

  // Test PKI: root -> intermediate -> leaf(127.0.0.1, AIA -> /inter.der); plus an unrelated bogus CA.
  const caExt = ext('ca.ext', 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('root.key'), '-out', f('root.pem'), '-days', '2', '-subj', '/CN=Test Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('inter.key'), '-out', f('inter.csr'), '-subj', '/CN=Test Intermediate 2025');
  ssl('x509', '-req', '-in', f('inter.csr'), '-CA', f('root.pem'), '-CAkey', f('root.key'), '-CAcreateserial', '-out', f('inter.pem'), '-days', '2', '-extfile', caExt);
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('bogus.key'), '-out', f('bogus.pem'), '-days', '2', '-subj', '/CN=Test Intermediate 2025', '-addext', 'basicConstraints=critical,CA:TRUE');
  const leafExt = (target) => ext(`leaf-${target}.ext`, `basicConstraints=CA:FALSE\nsubjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nauthorityInfoAccess=caIssuers;URI:http://127.0.0.1:${aiaPort}/${target}\n`);
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('leaf.key'), '-out', f('leaf.csr'), '-subj', '/CN=127.0.0.1');
  ssl('x509', '-req', '-in', f('leaf.csr'), '-CA', f('inter.pem'), '-CAkey', f('inter.key'), '-CAcreateserial', '-out', f('leaf.pem'), '-days', '2', '-extfile', leafExt('inter.der'));
  ssl('x509', '-req', '-in', f('leaf.csr'), '-CA', f('inter.pem'), '-CAkey', f('inter.key'), '-CAcreateserial', '-out', f('leaf-bogus.pem'), '-days', '2', '-extfile', leafExt('bogus.der'));
  certs['/inter.der'] = ssl('x509', '-in', f('inter.pem'), '-outform', 'DER');
  certs['/bogus.der'] = ssl('x509', '-in', f('bogus.pem'), '-outform', 'DER');
  const root = fs.readFileSync(f('root.pem'), 'utf8');

  // HTTPS servers that send ONLY the leaf (the misconfiguration).
  const serve = (leaf) => new Promise((r) => { const s = https.createServer({ key: fs.readFileSync(f('leaf.key')), cert: fs.readFileSync(leaf) }, (q, res) => { res.writeHead(200); res.end('Precinct_name,ok\n'); }); s.listen(0, '127.0.0.1', () => r(s)); });
  const good = await serve(f('leaf.pem')), bad = await serve(f('leaf-bogus.pem'));
  const url = (s) => `https://127.0.0.1:${s.address().port}/results.csv`;

  await t('incomplete chain fails normal verification (even with the root trusted)', async () => {
    await assert.rejects(aia.getWithCa(url(good), { ca: [root] }), (e) => aia.isChainError(e));
  });

  await t('chain completed via AIA: intermediate downloaded, checked against the root, request verified', async () => {
    const plain = (u) => aia.getWithCa(u, { ca: [root] }); // stands in for fetch() with system roots
    const text = await aia.fetchTextCompletingChain(url(good), plain, { rootPems: [root] });
    assert.strictEqual(text, 'Precinct_name,ok\n');
  });

  await t('an issuer that does not chain to a trusted root is refused', async () => {
    aia._cache.clear();
    const plain = (u) => aia.getWithCa(u, { ca: [root] });
    await assert.rejects(aia.fetchTextCompletingChain(url(bad), plain, { rootPems: [root] }), /issuer|chain/i);
  });

  await t('hostname checking stays on when the chain is completed', async () => {
    const inter = fs.readFileSync(f('inter.pem'), 'utf8');
    const u = `https://127.0.0.1:${good.address().port}/results.csv`; // connect by IP but claim another name below
    await assert.rejects(aia.getWithCa(u, { ca: [root, inter], headers: {}, servername: 'evil.example' }), (e) => { assert.strictEqual(e.code, 'ERR_TLS_CERT_ALTNAME_INVALID', e.message); return true; });
  });

  good.close(); bad.close(); aiaSrv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`test-aia: ${n} checks passed`);
})().catch((e) => { console.error('test-aia FAILED:', e.stack || e.message); process.exit(1); });
