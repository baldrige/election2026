'use strict';
// civicAPI tests: parsing real 2026 race documents, winner flags, the House shape, id checks,
// polling behaviour (search, ETag, rate limits, test data), and the Senate merge rule.
//   node tools/test-civic.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/civicapi');
const { mergeSenate } = require('../lib/merge');
const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', f), 'utf8'));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

(async () => {
  await t('SC Senate 2026 document parses (real, pre-election)', () => {
    const r = C.parseRace(fx('civic_sc_sen_2026.json'), 'S');
    assert.strictEqual(r.id, 'civic:S:SC'); assert.strictEqual(r.office, 'S'); assert.strictEqual(r.special, false);
    assert.deepStrictEqual(r.candidates.map((c) => c.party).slice(0, 2).sort(), ['Dem', 'GOP']);
    assert.strictEqual(r.winnerParty, null); assert.strictEqual(r.source, 'civicAPI (civicapi.org)');
    assert.match(r.reportingLabel, /0% reporting/);
  });

  await t('NH Governor 2026 document parses', () => {
    const r = C.parseRace(fx('civic_nh_gov_2026.json'), 'G');
    assert.strictEqual(r.title, 'NH · Governor'); assert.ok(r.candidates.some((c) => c.name === 'Kelly Ayotte' && c.party === 'GOP'));
  });

  await t('winner flags become a call (and can be turned off)', () => {
    const doc = { ...fx('civic_ia_pres_2024.json'), election_type: 'US Senate', election_name: 'Iowa US Senate' };
    const r = C.parseRace(doc, 'S');
    assert.strictEqual(r.winnerParty, 'GOP'); assert.strictEqual(r.calledBy, 'civicAPI');
    assert.strictEqual(r.candidates[0].winner, true);
    const off = C.parseRace(doc, 'S', false);
    assert.strictEqual(off.winnerParty, null); assert.ok(!off.candidates.some((c) => c.winner));
  });

  await t('special elections are flagged from the race name', () => {
    const r = C.parseRace({ ...fx('civic_sc_sen_2026.json'), province: 'OH', election_name: 'Ohio US Senate Special' }, 'S');
    assert.strictEqual(r.special, true); assert.strictEqual(r.id, 'civic:S:OH:special');
  });

  await t('House document: districts from region_results keys (shape per civicAPI client code; synthetic values)', () => {
    const h = C.parseHouse({ election_type: 'US House', region_results: {
      'az-01': { name: 'AZ-1', percent_reporting: 50, candidates: [{ name: 'A', party: 'Democratic', votes: 5 }, { name: 'B', party: 'Republican', votes: 2, winner: false }] },
      'ak-al': { name: 'AK', percent_reporting: 100, candidates: [{ name: 'C', party: 'Republican', votes: 1, winner: true }] },
      'statewide': { name: 'x', candidates: [] } } });
    assert.deepStrictEqual(h.map((r) => r.district), ['AZ-01', 'AK-AL']);
    assert.strictEqual(h[1].winnerParty, 'GOP'); assert.strictEqual(h[0].eevp, 50);
  });

  await t('a reassigned race id is detected', () => {
    const d = fx('civic_sc_sen_2026.json');
    assert.strictEqual(C.mismatch(d, { office: 'S', state: 'SC' }, '2026-11-03'), null);
    assert.match(C.mismatch(d, { office: 'S', state: 'GA' }, '2026-11-03'), /state SC/);
    assert.match(C.mismatch(d, { office: 'G', state: 'SC' }, '2026-11-03'), /type US Senate/);
    assert.match(C.mismatch(d, { office: 'S', state: 'SC' }, '2024-11-05'), /date/);
  });

  await t('provider: search for unknown ids, ETag 304, test data hidden, rate limit pauses everything', async () => {
    let now = 1e12; const calls = [];
    const sc = fx('civic_sc_sen_2026.json');
    const nh = fx('civic_nh_gov_2026.json');
    const reply = (status, body, headers = {}) => ({ ok: status < 300, status, headers: new Map(Object.entries(headers)), json: async () => body, text: async () => JSON.stringify(body) });
    let limit = false;
    global.fetch = async (url, opts) => {
      calls.push(url);
      if (limit) return reply(429, {}, { 'retry-after': '300' });
      if (url.includes('/race/search')) return reply(200, { races: [{ id: 999, province: 'NH', election_type: 'Governor', election_name: 'New Hampshire Governor', election_date: '2026-11-03T05:00:00.000Z' }, { id: 5, province: 'NH', election_type: 'Governor', election_name: 'New Hampshire Governor Primary', election_date: '2026-11-03' }] });
      if (url.endsWith('/race/87409')) return opts.headers['If-None-Match'] === 'v1' ? reply(304, null) : reply(200, sc, { etag: 'v1' });
      if (url.endsWith('/race/999')) return reply(200, { ...nh, test_data: true });
      return reply(404, {});
    };
    const cfg = { electionDate: '2026-11-03', civicapi: { baseUrl: 'https://civicapi.org/api/v2', senateStates: ['SC'], governorStates: ['NH'], house: false, raceIds: { 'S:SC': 87409 } } };
    const p = new C.CivicApiProvider(cfg, { now: () => now });
    await p.step(); // S:SC fetch
    await p.step(); // G:NH search -> id 999 (primary ignored)
    assert.strictEqual(p.races[1].id, 999);
    await p.step(); // S:SC again -> 304
    await p.step(); // G:NH fetch -> test data
    assert.strictEqual(p.results().length, 1, 'test-data race hidden, SC kept after 304');
    assert.match(p.races[1].error, /test data/);
    assert.ok(calls.some((u) => u.includes('query=New%20Hampshire%20Governor&date=2026-11-03')));
    limit = true; await p.step();
    const before = calls.length; now += 60e3; await p.step(); await p.step();
    assert.strictEqual(calls.length, before, 'no requests during the Retry-After pause');
    assert.match(p.status().message, /paused/);
    now += 300e3; limit = false; await p.step();
    assert.strictEqual(calls.length, before + 1, 'resumes after the pause');
  });

  await t('Senate merge: official counts win while the feed works; civicAPI call carried over by party', () => {
    const state = { id: 'state:NC:S', state: 'NC', special: false, office: 'S', candidates: [{ name: 'Roy Cooper', party: 'Dem', votes: 10 }, { name: 'Michael Whatley', party: 'GOP', votes: 9 }], winnerParty: null, source: 'NC State Board of Elections' };
    const civ = { id: 'civic:S:NC', state: 'NC', special: false, office: 'S', candidates: [], winnerParty: 'Dem', source: 'civicAPI (civicapi.org)' };
    const other = { id: 'civic:S:SC', state: 'SC', special: false, office: 'S', candidates: [], winnerParty: null };
    const m = mergeSenate([state], [civ, other], () => true);
    assert.strictEqual(m.length, 2);
    const nc = m.find((r) => r.state === 'NC');
    assert.strictEqual(nc.source, 'NC State Board of Elections'); assert.strictEqual(nc.winnerParty, 'Dem'); assert.strictEqual(nc.calledBy, 'civicAPI');
    assert.strictEqual(nc.candidates.find((c) => c.winner).name, 'Roy Cooper');
    const down = mergeSenate([{ ...state }], [civ], () => false);
    assert.strictEqual(down.length, 1); assert.strictEqual(down[0].source, 'civicAPI (civicapi.org)');
  });

  console.log(`test-civic: ${n} checks passed`);
})().catch((e) => { console.error('test-civic FAILED:', e.stack || e.message); process.exit(1); });
