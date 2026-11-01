'use strict';
// Find current market IDs to put in config.json.
//   node tools/find-markets.js senate
//   node tools/find-markets.js "georgia senate"
const { get } = require('../lib/http');
const q = process.argv.slice(2).join(' ') || 'midterm';
const words = q.toLowerCase().split(/\s+/);
const match = (t = '') => words.every((w) => t.toLowerCase().includes(w));

(async () => {
  console.log(`\nPolymarket events matching "${q}"  ->  config.markets.polymarket.eventSlugs`);
  try {
    const r = await get(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=15&events_status=active`);
    for (const e of r.events || []) console.log(`  ${e.slug.padEnd(60)} ${e.title}`);
  } catch (e) { console.log('  error:', e.message); }

  console.log(`\nKalshi open events matching "${q}"  ->  config.markets.kalshi.eventTickers (or the series ticker -> seriesTickers)`);
  try {
    let cursor = '', n = 0;
    for (let page = 0; page < 15; page++) {
      const r = await get(`https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
      for (const e of r.events || []) if (match(e.title) || match(e.sub_title)) { n++; console.log(`  ${e.event_ticker.padEnd(28)} series=${String(e.series_ticker).padEnd(14)} ${e.title}`); }
      if (!r.cursor) break; cursor = r.cursor;
    }
    if (!n) console.log('  (none)');
  } catch (e) { console.log('  error:', e.message); }

  console.log(`\nPredictIt markets matching "${q}"  ->  config.markets.predictit.marketIds`);
  try {
    const r = await get('https://www.predictit.org/api/marketdata/all/');
    for (const m of (r.markets || []).filter((m) => match(m.name))) console.log(`  ${String(m.id).padEnd(8)} ${m.name}`);
  } catch (e) { console.log('  error:', e.message); }
})();
