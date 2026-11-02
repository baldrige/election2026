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

async function fetchAll(ncfg) {
  const re = ncfg.keywordFilter ? new RegExp(ncfg.keywordFilter, 'i') : null;
  const errors = [], all = [];
  await Promise.all(ncfg.feeds.map(async (f) => {
    const r = await guard.run(f.name, async () => parseFeed(await get(f.url, { as: 'text' }), f.name));
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

module.exports = { fetchAll, parseFeed };
