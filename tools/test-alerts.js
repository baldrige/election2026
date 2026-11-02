'use strict';
// Alert detection (public/alerts.js, pure part): calls, lead changes, market swings, reload behaviour.
//   node tools/test-alerts.js
const assert = require('assert');
const A = require('../public/alerts.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
const S0 = (extra = {}) => ({ calls: [], results: { races: [] }, markets: { groups: [] }, mapOdds: {}, ...extra });
const set = { ...A.DEFAULTS };
const MIN = 60000;

t('first look: no alerts for calls that already exist', () => {
  const r = A.detect(null, S0({ calls: [{ ts: 100, key: 'S:NC', office: 'S', title: 'NC · U.S. Senate', party: 'Dem' }] }), set, new Set(), 1000);
  assert.strictEqual(r.alerts.length, 0); assert.strictEqual(r.state.lastCallTs, 100);
});

t('new calls: Senate/Governor alert by default; House only if starred; "all" and "off" respected', () => {
  const first = A.detect(null, S0(), set, new Set(), 1000).state;
  const calls = [
    { ts: 2000, key: 'H:AZ-01', office: 'H', title: 'AZ-01 · U.S. House', party: 'GOP', winner: 'A Person' },
    { ts: 1900, key: 'S:NC', office: 'S', title: 'NC · U.S. Senate', party: 'Dem', winner: 'Roy Cooper', by: 'civicAPI' },
  ];
  let r = A.detect(first, S0({ calls }), set, new Set(), 3000);
  assert.deepStrictEqual(r.alerts.map((a) => a.key), ['S:NC']);
  assert.strictEqual(r.alerts[0].body, 'Roy Cooper (D) wins, per civicAPI');
  r = A.detect(first, S0({ calls }), set, new Set(['H:AZ-01']), 3000);
  assert.deepStrictEqual(r.alerts.map((a) => a.key), ['S:NC', 'H:AZ-01'], 'oldest first');
  assert.strictEqual(A.detect(first, S0({ calls }), { ...set, calls: 'starred' }, new Set(), 3000).alerts.length, 0);
  assert.strictEqual(A.detect(first, S0({ calls }), { ...set, calls: 'all' }, new Set(), 3000).alerts.length, 2);
  assert.strictEqual(A.detect(first, S0({ calls }), { ...set, calls: 'off' }, new Set(), 3000).alerts.length, 0);
  // the same calls on the next refresh don't alert again
  const again = A.detect(r.state, S0({ calls }), set, new Set(), 4000);
  assert.strictEqual(again.alerts.length, 0);
});

t('after a reload: catch up on calls since last look, but at most 10 minutes back', () => {
  const now = 100 * MIN;
  const calls = [{ ts: now - 5 * MIN, key: 'S:GA', office: 'S', title: 'GA', party: 'Dem' }, { ts: now - 60 * MIN, key: 'S:TX', office: 'S', title: 'TX', party: 'GOP' }];
  const r = A.detect(null, S0({ calls }), set, new Set(), now, now - 120 * MIN);
  assert.deepStrictEqual(r.alerts.map((a) => a.key), ['S:GA']);
});

const race = (a, b, extra = {}) => ({ office: 'S', state: 'GA', title: 'GA · U.S. Senate', reportingLabel: '40% reporting',
  candidates: [a, b].sort((x, y) => y.votes - x.votes).map((c) => ({ ...c, pct: (100 * c.votes) / (a.votes + b.votes) })), ...extra });
const D = (v) => ({ name: 'Jon Ossoff', party: 'Dem', votes: v }), R = (v) => ({ name: 'Mike Collins', party: 'GOP', votes: v });

t('lead change: starred races only, needs real counts, not on first sight', () => {
  const stars = new Set(['S:GA']);
  let st = A.detect(null, S0({ results: { races: [race(D(600), R(500))] } }), set, stars, 1).state;
  let r = A.detect(st, S0({ results: { races: [race(D(700), R(800))] } }), set, stars, 2);
  assert.strictEqual(r.alerts.length, 1); assert.match(r.alerts[0].body, /^Mike Collins \(R\) now leads by 6\.7 pts, 40% reporting$/);
  r = A.detect(st, S0({ results: { races: [race(D(700), R(800))] } }), set, new Set(), 2);
  assert.strictEqual(r.alerts.length, 0, 'not starred');
  st = A.detect(null, S0({ results: { races: [race(D(30), R(20))] } }), set, stars, 1).state;
  r = A.detect(st, S0({ results: { races: [race(D(30), R(40))] } }), set, stars, 2);
  assert.strictEqual(r.alerts.length, 0, 'below the vote minimum');
});

t('market swing on a control widget: alerts once per move, only within the window', () => {
  const g = (dem) => S0({ markets: { groups: [{ key: 'senate:2026', label: 'Senate control · 2026', dem }] } });
  let st = A.detect(null, g(0.50), set, new Set(), 0).state;
  st = A.detect(st, g(0.53), set, new Set(), 5 * MIN).state;
  const r = A.detect(st, g(0.61), set, new Set(), 10 * MIN);
  assert.strictEqual(r.alerts.length, 1); assert.strictEqual(r.alerts[0].body, 'Democrats 50% → 61% (+11 pts in 10 min)');
  assert.strictEqual(A.detect(r.state, g(0.62), set, new Set(), 11 * MIN).alerts.length, 0, 'no repeat for the same move');
  // slow drift: 50 -> 58 -> 66 over 40 min never moves 10 pts within 15 min
  let s2 = A.detect(null, g(0.50), set, new Set(), 0).state;
  s2 = A.detect(s2, g(0.58), set, new Set(), 20 * MIN).state;
  assert.strictEqual(A.detect(s2, g(0.66), set, new Set(), 40 * MIN).alerts.length, 0);
});

t('market swing on a starred race uses its odds (or the map odds when results are pending)', () => {
  const odds = (d) => ({ Kalshi: { o: [{ p: 'Dem', v: d }, { p: 'GOP', v: 1 - d }] } });
  const pend = (d) => S0({ results: { races: [{ office: 'S', state: 'ME', title: 'ME · U.S. Senate', pending: true, candidates: [] }] }, mapOdds: { 'S:ME': odds(d) } });
  const stars = new Set(['S:ME']);
  const st = A.detect(null, pend(0.45), set, stars, 0).state;
  const r = A.detect(st, pend(0.30), set, stars, 3 * MIN);
  assert.strictEqual(r.alerts.length, 1); assert.strictEqual(r.alerts[0].key, 'S:ME'); assert.match(r.alerts[0].body, /45% → 30% \(−15 pts in 3 min\)/);
});

console.log(`test-alerts: ${n} checks passed`);
