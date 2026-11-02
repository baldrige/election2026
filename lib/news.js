'use strict';
// Dependency-free RSS 2.0 / Atom reader for headline feeds.
const { get } = require('./http');
const { Guard } = require('./guard');
const guard = new Guard();

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function clean(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, '') // descriptions often carry entity-encoded HTML
    .replace(/\s+/g, ' ')
    .trim();
}
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = clean(tag(b, 'link'));
    if (!link) { const m = b.match(/<link\b[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const when = clean(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'));
    const ts = Date.parse(when);
    items.push({
      source,
      title: clean(tag(b, 'title')),
      link,
      summary: clean(tag(b, 'description') || tag(b, 'summary')).slice(0, 280),
      ts: Number.isFinite(ts) ? ts : null,
    });
  }
  return items.filter((i) => i.title && i.link);
}

// Fallback feeds: [{ name, url, titleSuffix }]. (Older configs used fallbackUrl/fallbackName/fallbackTitleSuffix.)
function fallbacksOf(f) {
  const list = Array.isArray(f.fallbacks) ? f.fallbacks.filter((x) => x && x.url && x.enabled !== false) : [];
  if (f.fallbackUrl) list.push({ name: f.fallbackName || 'fallback feed', url: f.fallbackUrl, titleSuffix: f.fallbackTitleSuffix });
  return list;
}

// Aggregator titles may end with " - Publisher"; drop that and note where the item came from.
function fromFallback(item, fb) {
  const suffix = fb.titleSuffix || fb.fallbackTitleSuffix;
  const strip = suffix ? new RegExp(`\\s+[-–|]\\s+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null;
  return { ...item, title: strip ? item.title.replace(strip, '') : item.title, via: fb.name || fb.fallbackName || 'fallback feed' };
}

async function fetchAll(ncfg) {
  const re = ncfg.keywordFilter ? new RegExp(ncfg.keywordFilter, 'i') : null;
  const errors = [], all = [];
  await Promise.all(ncfg.feeds.filter((f) => f.enabled !== false).map(async (f) => {
    const r = await guard.run(f.name, async () => parseFeed(await get(f.url, { as: 'text' }), f.name));
    // If the publisher's own feed is failing, try its fallbacks in order (first one with headlines wins).
    if (r.error) {
      const fbErrors = [];
      for (const fbk of fallbacksOf(f)) {
        const fb = await guard.run(`${f.name} via ${fbk.name}`, async () => parseFeed(await get(fbk.url, { as: 'text' }), f.name).map((i) => fromFallback(i, fbk)));
        if (fb.data && fb.data.length) {
          errors.push(`${f.name}: own feed failing (${r.error.replace(/^[^:]+:\s*/, '').split(';')[0]}); showing its headlines via ${fbk.name}`);
          all.push(...fb.data);
          return;
        }
        if (fb.error) fbErrors.push(fb.error.split(';')[0]);
      }
      if (fbErrors.length) { errors.push(`${r.error.split(';').slice(0, 2).join(';')}; fallbacks also failing (${fbErrors.join(' / ')})`); all.push(...(r.data || [])); return; }
    }
    if (r.error) errors.push(r.error);
    all.push(...(r.data || [])); // a failing feed keeps its last good headlines
  }));
  const seen = new Set();
  const items = all
    .filter((i) => !re || re.test(i.title + ' ' + i.summary))
    .filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, ncfg.maxItems || 100);
  return { items, errors };
}

module.exports = { fetchAll, parseFeed, fromFallback, fallbacksOf };
