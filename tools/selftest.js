'use strict';
// Offline checks of each adapter's parsing, using response shapes from the providers' public docs.
// Run: node tools/selftest.js
const assert = require('assert');
const routes = {
  'gamma-api.polymarket.com': [{ title: 'Which party will win the House?', volume: '1234567', markets: [
    { groupItemTitle: 'Democratic', outcomePrices: '["0.61","0.39"]', closed: false },
    { groupItemTitle: 'Republican', outcomePrices: '["0.39","0.61"]', closed: false }] }],
  'api.elections.kalshi.com': { events: [{ event_ticker: 'CONTROLH-2026', series_ticker: 'CONTROLH', title: 'House control', markets: [
    { yes_sub_title: 'Democrats', yes_bid: 60, yes_ask: 62, volume: 1000 },
    { yes_sub_title: 'Republicans', yes_bid_dollars: '0.3800', yes_ask_dollars: '0.4000', volume: 900 }] }] },
  'www.predictit.org': { name: 'Which party wins the House?', url: 'https://x', contracts: [{ shortName: 'Dem', lastTradePrice: 0.6 }, { shortName: 'GOP', lastTradePrice: 0.41 }] },
};
global.fetch = async (url) => {
  const host = new URL(url).host;
  if (!(host in routes)) return { ok: false, status: 404, text: async () => 'nope' };
  return { ok: true, json: async () => routes[host], text: async () => JSON.stringify(routes[host]) };
};

(async () => {
  const m = require('../lib/markets');
  const cfg = require('../config.json').markets;
  const pm = await m.polymarket(cfg.polymarket);
  assert.strictEqual(pm[0].outcomes[0].label, 'Democratic'); assert.strictEqual(pm[0].outcomes[0].prob, 0.61);
  const k = await m.kalshi({ ...cfg.kalshi, seriesTickers: ['CONTROLH'] });
  assert.strictEqual(k[0].outcomes[0].prob, 0.61); assert.ok(Math.abs(k[0].outcomes[1].prob - 0.39) < 1e-9);
  const pi = await m.predictit({ baseUrl: cfg.predictit.baseUrl, marketIds: [1] });
  assert.strictEqual(pi[0].outcomes[0].label, 'Dem');

  const { parseFeed } = require('../lib/news');
  const rss = parseFeed(`<rss><channel><item><title><![CDATA[Polls close &amp; counting begins]]></title><link>https://a/1</link>
    <pubDate>Tue, 03 Nov 2026 19:05:00 -0500</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>`, 'X');
  assert.strictEqual(rss[0].title, 'Polls close & counting begins'); assert.strictEqual(rss[0].summary, 'Hi'); assert.ok(rss[0].ts);
  const atom = parseFeed(`<feed><entry><title>Turnout up</title><link href="https://b/2"/><updated>2026-11-03T20:00:00Z</updated></entry></feed>`, 'Y');
  assert.strictEqual(atom[0].link, 'https://b/2');

  const bad = await m.fetchAll({ ...cfg, kalshi: { ...cfg.kalshi, baseUrl: 'https://down.example' } });
  assert.ok(bad.errors.some((e) => e.startsWith('Kalshi')) && bad.markets.length > 0, 'one broken source must not blank the panel');
  // --- failure handling: rate limits and bad gateways keep last good data and back off ---
  const { Guard } = require('../lib/guard');
  const { HttpError, summarize } = require('../lib/http');
  const g = new Guard(); let calls = 0; const t0 = Date.parse('2026-11-04T02:00:00Z');
  const ok1 = await g.run('Kalshi', async () => { calls++; return ['m1']; }, t0);
  assert.deepStrictEqual(ok1.data, ['m1']); assert.strictEqual(ok1.error, null);
  const lim = await g.run('Kalshi', async () => { calls++; throw new HttpError('HTTP 429', { status: 429, retryAfter: 300 }); }, t0 + 30e3);
  assert.deepStrictEqual(lim.data, ['m1']); assert.ok(lim.stale);
  assert.match(lim.error, /^Kalshi: rate-limited \(HTTP 429\); retrying in 5 min; showing data from 9:00 PM ET$/);
  await g.run('Kalshi', async () => { calls++; return ['never']; }, t0 + 120e3); // still inside Retry-After window
  assert.strictEqual(calls, 2, 'must not call Kalshi again before Retry-After expires');
  const back = await g.run('Kalshi', async () => { calls++; return ['m2']; }, t0 + 31e3 + 300e3);
  assert.deepStrictEqual(back.data, ['m2']); assert.strictEqual(back.error, null);
  assert.strictEqual(summarize('<html>\n<head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>'), '502 Bad Gateway');

  // End to end through news.fetchAll: WaPo goes down after one good fetch; its headlines stay.
  const news = require('../lib/news');
  let wapoUp = true;
  global.fetch = async (url) => {
    if (url.includes('wapo.example')) {
      if (!wapoUp) return { ok: false, status: 502, headers: new Map(), text: async () => '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>' };
      return { ok: true, status: 200, text: async () => '<rss><item><title>Election night turnout</title><link>https://wapo.example/a</link><pubDate>Tue, 03 Nov 2026 20:00:00 -0500</pubDate></item></rss>' };
    }
    return { ok: false, status: 404, headers: new Map(), text: async () => '' };
  };
  const ncfg = { feeds: [{ name: 'Washington Post', url: 'https://wapo.example/rss' }], keywordFilter: 'elect' };
  assert.strictEqual((await news.fetchAll(ncfg)).items.length, 1);
  wapoUp = false;
  const down = await news.fetchAll(ncfg);
  assert.strictEqual(down.items.length, 1, 'last good headlines are kept');
  assert.match(down.errors[0], /^Washington Post: HTTP 502 from wapo\.example \(502 Bad Gateway\); retrying in 30 s; showing data from /);
  console.log('    e.g.', down.errors[0]);

  // --- market grouping: one widget per question across platforms ---
  const { groupMarkets, partyOf } = require('../lib/markets');
  assert.strictEqual(partyOf('Democratic Party'), 'Dem'); assert.strictEqual(partyOf('GOP'), 'GOP');
  assert.strictEqual(partyOf('D House, R Senate'), null, 'combo outcomes are not a party');
  const mk = (key, source, title, outcomes, year = 2026) => ({ key, source, title, url: '#', volume: 1, outcomes, year });
  const groups = require('../config.json').markets.groups;
  const grouped = groupMarkets([
    mk('k', 'Kalshi', 'Which party will win the House?', [{ label: 'Democrats', prob: 0.62 }, { label: 'Republicans', prob: 0.4 }]),
    mk('p', 'Polymarket', 'House control 2026', [{ label: 'Democratic', prob: 0.58 }]),
    mk('pi', 'PredictIt', 'Which party will control the Senate after 2026?', [{ label: 'Republican', prob: 0.6 }, { label: 'Democratic', prob: 0.41 }]),
    mk('ga', 'Kalshi', 'Georgia Senate race', [{ label: 'Democrats', prob: 0.55 }, { label: 'Republicans', prob: 0.45 }]),
    mk('bop', 'Polymarket', 'Balance of power: House and Senate', [{ label: 'D House, R Senate', prob: 0.5 }]),
    mk('k28', 'Kalshi', 'Which party will win the House?', [{ label: 'Democrats', prob: 0.5 }, { label: 'Republicans', prob: 0.5 }], 2028),
  ], groups);
  const house = grouped.groups.find((x) => x.key === 'house:2026'), senate = grouped.groups.find((x) => x.key === 'senate:2026');
  const house28 = grouped.groups.find((x) => x.key === 'house:2028');
  assert.deepStrictEqual(house28.rows.map((r) => r.key), ['k28'], '2028 markets get their own widget');
  assert.strictEqual(house.label, 'House control · 2026');
  assert.deepStrictEqual(grouped.groups.map((x) => x.key), ['senate:2026', 'house:2026', 'house:2028'], '2026 first');
  assert.deepStrictEqual(house.rows.map((r) => r.source), ['Kalshi', 'Polymarket']);
  assert.ok(Math.abs(house.rows[0].dem - 0.62 / 1.02) < 1e-9, 'two-party prices are renormalised');
  assert.ok(Math.abs(house.rows[1].gop - 0.42) < 1e-9, 'missing side is the complement');
  assert.ok(Math.abs(house.dem - (0.62 / 1.02 + 0.58) / 2) < 1e-9, 'widget shows the average');
  assert.strictEqual(senate.rows.length, 1);
  assert.deepStrictEqual(grouped.others.map((m) => m.key).sort(), ['bop', 'ga'], 'state races and combos stay separate');

  // --- saved state: round trip, and the cases where it must be ignored ---
  const persist = require('../lib/persist');
  const os = require('os'), fsx = require('fs'), px = require('path');
  const file = px.join(fsx.mkdtempSync(px.join(os.tmpdir(), 'persist-')), 'sub', 'state.json');
  const hist = { 'group:house:2026': Object.assign([[1, 0.5], [2, 0.52]], { label: 'Dem' }) };
  persist.save(file, { electionDate: '2026-11-03', calls: [{ id: 'x', party: 'Dem' }], calledSeen: new Map([['x', 'Dem']]), history: hist });
  const restoredSnap = persist.load(file, { electionDate: '2026-11-03' });
  assert.deepStrictEqual(restoredSnap.calls, [{ id: 'x', party: 'Dem' }]); assert.strictEqual(restoredSnap.calledSeen.get('x'), 'Dem');
  assert.deepStrictEqual([...restoredSnap.history['group:house:2026']], [[1, 0.5], [2, 0.52]]);
  assert.strictEqual(restoredSnap.history['group:house:2026'].label, 'Dem', 'trend-line label survives the round trip');
  assert.match(persist.load(file, { electionDate: '2028-11-07' }).skipped, /for 2026-11-03/);
  fsx.writeFileSync(file, '{"v":1,"electionDate":"2026-11-03","calls":[');
  assert.match(persist.load(file, { electionDate: '2026-11-03' }).skipped, /unreadable/);
  assert.match(persist.load(file + '.missing', { electionDate: '2026-11-03' }).skipped, /no saved state/);

  // --- news fallback: publisher feed failing -> its headlines via Google News (Google News RSS shape) ---
  const newsMod = require('../lib/news');
  let ownUp = true;
  global.fetch = async (url) => {
    if (url.startsWith('https://own.example')) return ownUp
      ? { ok: true, status: 200, text: async () => '<rss><item><title>Own feed: polls close in Virginia</title><link>https://own.example/1</link><pubDate>Tue, 03 Nov 2026 19:00:00 -0500</pubDate></item></rss>' }
      : { ok: false, status: 502, headers: new Map(), text: async () => '<html><head><title>502 Bad Gateway</title></head></html>' };
    if (url.startsWith('https://news.google.com/')) return { ok: true, status: 200, text: async () => '<rss><channel><item><title>Senate control hinges on Georgia - The Washington Post</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Tue, 03 Nov 2026 21:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Senate control hinges on Georgia&lt;/a&gt;</description><source url="https://www.washingtonpost.com">The Washington Post</source></item></channel></rss>' };
    return { ok: false, status: 404, headers: new Map(), text: async () => '' };
  };
  const fcfg = { keywordFilter: 'elect|poll|senate', feeds: [{ name: 'Example Post', url: 'https://own.example/rss', fallbackUrl: 'https://news.google.com/rss/search?q=x', fallbackName: 'Google News', fallbackTitleSuffix: 'The Washington Post' }] };
  const up = await newsMod.fetchAll(fcfg);
  assert.deepStrictEqual(up.items.map((i) => i.title), ['Own feed: polls close in Virginia']); assert.strictEqual(up.errors.length, 0, 'fallback unused while the own feed works');
  ownUp = false;
  const fb = await newsMod.fetchAll(fcfg);
  assert.deepStrictEqual(fb.items.map((i) => [i.source, i.title, i.via]), [['Example Post', 'Senate control hinges on Georgia', 'Google News']]);
  assert.match(fb.errors[0], /^Example Post: own feed failing \(HTTP 502 .*502 Bad Gateway\)\); showing its headlines via Google News$/);

  console.log('selftest: all checks passed');
})().catch((e) => { console.error('selftest FAILED:', e.message); process.exit(1); });
