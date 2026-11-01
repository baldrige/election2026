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

  const { normalizeApRace } = require('../lib/results');
  const r = normalizeApRace({ raceID: '12345', statePostal: 'GA', officeID: 'S', officeName: 'U.S. Senate', raceType: 'General',
    reportingUnits: [{ level: 'state', eevp: 87.4, lastUpdated: '2026-11-04T02:01:00Z', candidates: [
      { first: 'Jane', last: 'Roe', party: 'GOP', voteCount: 1500000 },
      { first: 'John', last: 'Doe', party: 'Dem', voteCount: 1600000, winner: 'X' }] }] });
  assert.strictEqual(r.winnerParty, 'Dem'); assert.strictEqual(r.candidates[0].name, 'John Doe'); assert.strictEqual(r.eevp, 87.4);
  const h = normalizeApRace({ raceID: '9', statePostal: 'PA', officeID: 'H', seatNum: '7', reportingUnits: [{ level: 'state', candidates: [] }] });
  assert.strictEqual(h.district, 'PA-07');

  const { parseFeed } = require('../lib/news');
  const rss = parseFeed(`<rss><channel><item><title><![CDATA[Polls close &amp; counting begins]]></title><link>https://a/1</link>
    <pubDate>Tue, 03 Nov 2026 19:05:00 -0500</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>`, 'X');
  assert.strictEqual(rss[0].title, 'Polls close & counting begins'); assert.strictEqual(rss[0].summary, 'Hi'); assert.ok(rss[0].ts);
  const atom = parseFeed(`<feed><entry><title>Turnout up</title><link href="https://b/2"/><updated>2026-11-03T20:00:00Z</updated></entry></feed>`, 'Y');
  assert.strictEqual(atom[0].link, 'https://b/2');

  const bad = await m.fetchAll({ ...cfg, kalshi: { ...cfg.kalshi, baseUrl: 'https://down.example' } });
  assert.ok(bad.errors.some((e) => e.startsWith('Kalshi')) && bad.markets.length > 0, 'one broken source must not blank the panel');
  console.log('selftest: all checks passed');
})().catch((e) => { console.error('selftest FAILED:', e.message); process.exit(1); });
