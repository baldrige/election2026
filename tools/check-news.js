'use strict';
// Diagnose news feeds from wherever the dashboard runs (e.g. Render's Shell).
//   node tools/check-news.js                   (all feeds)
//   node tools/check-news.js "Washington Post" (one feed, plus its fallback)
// For each feed: HTTP status, server/CDN headers, content type, size, items parsed and newest date.
// If the dashboard's own request fails, it also tries a generic client, to tell "server down"
// apart from "blocks this kind of client/network".
const cfg = require('../config.json');
const { parseFeed } = require('../lib/news');
const { summarize } = require('../lib/http');

const OURS = 'ElectionNightDashboard/1.0 (personal, non-commercial)';
const GENERIC = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe(url, ua) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    const h = (k) => res.headers.get(k);
    const hdr = ['server', 'via', 'x-cache', 'cf-ray', 'x-akamai-request-id', 'location'].map((k) => h(k) && `${k}=${h(k)}`).filter(Boolean).join(' ');
    let items = [];
    try { items = parseFeed(body, 'x'); } catch { /* not a feed */ }
    const newest = items.map((i) => i.ts).filter(Boolean).sort((a, b) => b - a)[0];
    return `HTTP ${res.status} in ${Date.now() - t0} ms · ${h('content-type') || 'no content-type'} · ${body.length} bytes · ${items.length} items${newest ? ` · newest ${new Date(newest).toISOString()}` : ''}${res.url !== url ? ` · final URL ${res.url}` : ''}\n      headers: ${hdr || '(none of interest)'}${res.ok ? '' : `\n      body: ${summarize(body)}`}`;
  } catch (e) {
    return `FAILED in ${Date.now() - t0} ms: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;
  }
}

(async () => {
  const want = process.argv.slice(2).join(' ').toLowerCase();
  const feeds = cfg.news.feeds.filter((f) => !want || f.name.toLowerCase().includes(want));
  for (const f of feeds) {
    console.log(`\n${f.name}\n  ${f.url}`);
    const ours = await probe(f.url, OURS);
    console.log(`    dashboard client: ${ours}`);
    if (!/^HTTP 200/.test(ours) || / 0 items/.test(ours)) console.log(`    generic client:   ${await probe(f.url, GENERIC)}`);
    if (f.fallbackUrl) console.log(`  fallback (${f.fallbackName || 'fallback'}):\n    ${await probe(f.fallbackUrl, OURS)}`);
  }
  console.log('\nIf the dashboard client fails but the generic client works, the site is blocking this client;'
    + '\nif both fail with 5xx, the site\'s feed server is down; if both work here, the problem was temporary.\n');
})();
