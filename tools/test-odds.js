'use strict';
// Race-level market odds: parsing real Kalshi/Polymarket race events (captured 2026-10-27),
// key mapping, Kalshi batching + fallback, and the shared Kalshi throttle.
//   node tools/test-odds.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../lib/raceodds');
const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', f), 'utf8'));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

(async () => {
  await t('Kalshi race events: party from ticker suffix, candidate names, midpoint prices', () => {
    const tx = fx('kalshi_senatetx-26.json');
    const o = R.kalshiOutcomes(tx.markets);
    const rep = o.find((x) => x.party === 'GOP');
    assert.strictEqual(rep.name, 'Ken Paxton'); assert.ok(Math.abs(rep.prob - 0.345) < 1e-9);
    assert.strictEqual(R.kalshiKey(tx.event.event_ticker), 'S:TX');
    assert.strictEqual(R.kalshiKey('HOUSEAKAL-26'), 'H:AK-AL');
    assert.strictEqual(R.kalshiKey('GOVPARTYTX-26'), 'G:TX');
    assert.strictEqual(R.kalshiKey('CONTROLH-26'), null, 'chamber-control events are not races');
    assert.strictEqual(R.kalshiTicker('H:CA-22'), 'HOUSECA22-26'); assert.strictEqual(R.kalshiTicker('G:AK', '26', { AK: 'KXGOVAK' }), 'KXGOVAK-26');
  });

  await t('Polymarket race events: titles to races, parties from "(D)", candidate-only races, placeholders skipped', () => {
    const tx = fx('polymarket_texas-senate.json');
    assert.strictEqual(R.polymarketKey(tx.title), 'S:TX');
    const o = R.polymarketOutcomes(tx);
    assert.deepStrictEqual(o.map((x) => [x.name, x.party, x.prob]), [['James Talarico', 'Dem', 0.675], ['Ken Paxton', 'GOP', 0.325]]);
    const ca = fx('polymarket_california-governor.json');
    assert.strictEqual(R.polymarketKey(ca.title), 'G:CA');
    const top = R.polymarketOutcomes(ca).sort((a, b) => b.prob - a.prob)[0];
    assert.strictEqual(top.name, 'Xavier Becerra'); assert.strictEqual(top.party, null);
    assert.strictEqual(R.polymarketKey('New York 3rd Congressional District Election Winner'), 'H:NY-03');
    assert.strictEqual(R.polymarketKey('West Virginia Senate Election Winner'), 'S:WV');
  });

  const cfg = { electionDate: '2026-11-03', markets: { kalshi: { baseUrl: 'https://k' }, polymarket: { baseUrl: 'https://p' }, raceMarkets: { kalshiMinGapMs: 1 } } };
  const races = [{ office: 'S', state: 'TX' }, { office: 'G', state: 'TX' }, { office: 'H', state: 'AK', district: 'AK-AL' }, { office: 'H', state: 'CA', district: 'CA-22' }];
  const allMarkets = [...fx('kalshi_senatetx-26.json').markets, ...fx('kalshi_govpartytexas-26.json').markets, ...fx('kalshi_houseakal-26.json').markets];
  const ok = (b) => ({ ok: true, status: 200, headers: new Map(), json: async () => b, text: async () => JSON.stringify(b) });

  await t('Kalshi batching: one request for up to 10 races, Senate/Governor first', async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(url);
      const evs = new URL(url).searchParams.get('event_ticker').split(',');
      return ok({ markets: allMarkets.filter((m) => evs.includes(m.event_ticker || m.ticker.replace(/-[^-]+$/, ''))) });
    };
    const p = new R.RaceOddsProvider(cfg); p.setRaces(races);
    await p.kalshiPass();
    assert.strictEqual(urls.length, 1); assert.ok(p.batch);
    assert.match(urls[0], /event_ticker=SENATETX-26,GOVPARTYTX-26,HOUSEAKAL-26,HOUSECA22-26/);
    const tx = p.forRace({ office: 'S', state: 'TX' });
    assert.strictEqual(tx.Kalshi.o[0].p, 'Dem'); assert.strictEqual(p.forRace({ office: 'H', district: 'AK-AL' }).Kalshi.o[0].n, 'Nick Begich III');
  });

  await t('Kalshi without batching: falls back to one event per request, Senate/Governor only', async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/markets')) { // API ignores the list: answers for the first ticker only
        const first = u.searchParams.get('event_ticker').split(',')[0];
        return ok({ markets: allMarkets.filter((m) => (m.event_ticker || m.ticker.replace(/-[^-]+$/, '')) === first) });
      }
      const tk = u.pathname.split('/').pop();
      const ms = allMarkets.filter((m) => (m.event_ticker || m.ticker.replace(/-[^-]+$/, '')) === tk);
      return ms.length ? ok({ event: { event_ticker: tk }, markets: ms }) : { ok: false, status: 404, headers: new Map(), text: async () => '' };
    };
    const p = new R.RaceOddsProvider(cfg); p.setRaces(races);
    await p.kalshiPass();
    assert.strictEqual(p.batch, false);
    const perEvent = urls.filter((u) => u.includes('/events/'));
    assert.deepStrictEqual(perEvent.map((u) => u.split('/events/')[1].split('?')[0]), ['SENATETX-26', 'GOVPARTYTX-26']);
    assert.match(p.status.Kalshi, /House skipped/);
    assert.ok(p.forRace({ office: 'G', state: 'TX' }).Kalshi);
  });

  await t('odds are fetched for every configured Senate/Governor race, even before results load', async () => {
    const urls = [];
    global.fetch = async (url) => { urls.push(url); return ok({ markets: [] }); };
    const p = new R.RaceOddsProvider({ ...cfg, civicapi: { senateStates: ['TX', 'GA'], governorStates: ['TX'] } });
    p.setRaces([{ office: 'H', state: 'AK', district: 'AK-AL' }]); // results so far: one House race only
    await p.kalshiPass();
    assert.match(urls[0], /event_ticker=SENATETX-26,SENATEGA-26,GOVPARTYTX-26,HOUSEAKAL-26/);
  });

  await t('Kalshi 429 pauses every Kalshi request (shared throttle)', async () => {
    const { Gate } = require('../lib/kalshi');
    const g = new Gate(1); let calls = 0;
    await g.run(async () => { calls++; const e = new Error('429'); e.status = 429; e.retryAfter = 1; throw e; }).catch(() => {});
    assert.ok(g.paused() >= 119, 'pauses at least 2 minutes');
    const t0 = Date.now();
    await assert.rejects(g.run(async () => { calls++; }), /paused/);
    assert.ok(Date.now() - t0 < 50 && calls === 1, 'fails fast during the pause instead of waiting');
  });

  await t('control-market requests jump ahead of the race-odds sweep', async () => {
    const { Gate } = require('../lib/kalshi');
    const g = new Gate(5); const order = [];
    const jobs = [1, 2, 3].map((i) => g.run(async () => order.push(`low${i}`)));
    jobs.push(g.run(async () => order.push('high'), { priority: 'high' }));
    await Promise.all(jobs);
    assert.deepStrictEqual(order, ['low1', 'high', 'low2', 'low3']);
  });

  console.log(`test-odds: ${n} checks passed`);
})().catch((e) => { console.error('test-odds FAILED:', e.stack || e.message); process.exit(1); });
