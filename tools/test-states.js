'use strict';
// Parser tests for official state feeds, using real files captured from state sites
// (2026 files were staged before election day, so their vote counts are zero).
//   node tools/test-states.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fx = (f) => fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', f), 'utf8');
const json = (f) => JSON.parse(fx(f));
const S = (st) => require(`../lib/states/${st}`);
const show = (r) => `${r.title}: ${r.candidates.map((c) => `${c.name} (${c.party}) ${c.votes}`).join(', ')} [${r.reportingLabel}]`;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

t('NC 2026 staged file: Senate contest, 4 candidates, precinct total', () => {
  const [r] = S('nc').parse(json('nc_results_0_2026.json'));
  assert.strictEqual(r.state, 'NC'); assert.strictEqual(r.candidates.length, 4);
  assert.ok(r.candidates.some((c) => c.name === 'Roy Cooper' && c.party === 'Dem'));
  assert.ok(r.candidates.some((c) => c.name === 'Michael Whatley' && c.party === 'GOP'));
  assert.match(r.reportingLabel, /of 2,626 precincts/);
  // With votes filled in, shares and order follow
  const rows = json('nc_results_0_2026.json').map((x) => ({ ...x, vct: x.bnm === 'Roy Cooper' ? '1200' : x.bnm === 'Michael Whatley' ? '1000' : '10', prt: '1313' }));
  const [r2] = S('nc').parse(rows);
  assert.strictEqual(r2.candidates[0].name, 'Roy Cooper'); assert.strictEqual(r2.eevp, 50);
  console.log('    ', show(r2));
});

t('GA 2024 export: contest parsed, county precincts summed, party suffix stripped', () => {
  const doc = json('ga_export_2024_trimmed.json');
  doc.results.ballotItems[0].name = 'US Senate'; // 2024 had no GA Senate race; reuse the real presidential item's shape
  const [r] = S('ga').parse(doc);
  assert.strictEqual(r.candidates[0].name, 'Donald J. Trump'); assert.strictEqual(r.candidates[0].party, 'GOP');
  assert.ok(r.candidates[0].votes > 2_000_000);
  assert.ok(r.reportingLabel && /precincts/.test(r.reportingLabel));
  console.log('    ', show(r));
});

t('IA 2026 Clarity summary: Senate found, write-in dropped, counties reporting label', () => {
  const [r] = S('ia').parse(json('ia_summary_2026.json'));
  assert.deepStrictEqual(r.candidates.map((c) => c.name).sort(), ['Ashley Hinson', 'Josh Turek', 'Thomas Laehn']);
  assert.match(r.reportingLabel, /^2 of 99 counties reporting$/);
  const live = S('ia').parseClarity(json('ia_summary_2024.json').map((c) => ({ ...c, C: 'United States Senator' })), 'IA');
  assert.ok(live[0].candidates[0].votes > 100000); // real 2024 counts, contest renamed
});

t('TX 2026 Civix: base64 sections decoded, Senate found, polling places label', () => {
  const [r] = S('tx').parse(json('tx_53815_election_2026.json'));
  assert.ok(r.candidates.some((c) => c.name === 'KEN PAXTON' && c.party === 'GOP'));
  assert.match(r.reportingLabel, /of 5,302 polling places/);
  console.log('    ', show(r));
});

t('OH 2026: Senate grouping found in contest list, county rows summed, special flagged', () => {
  const groups = S('oh').findSenate(json('oh_contest_list_2026.json'));
  assert.strictEqual(groups.length, 1); assert.strictEqual(groups[0].contestObjectId, '_55A742EA56A709A3E0633390EE0AE290');
  const r = S('oh').parse(json('oh_us_senator_2026.json'), groups[0].displayName);
  assert.strictEqual(r.special, true); assert.ok(r.candidates.length >= 2);
  assert.ok(r.candidates.some((c) => c.party === 'Dem') && r.candidates.some((c) => c.party === 'GOP'));
  console.log('    ', show(r));
});

t('MI 2024 county file: rows summed across counties, footer ignored', () => {
  const [r] = S('mi').parse('TOTAL VOTER TURNOUT: 123\n' + fx('mi_cenr_2024_subset.txt'));
  assert.strictEqual(r.state, 'MI'); assert.ok(r.candidates[0].votes > 100000);
  assert.ok(r.candidates.some((c) => c.party === 'Dem') && r.candidates.some((c) => c.party === 'GOP'));
  assert.match(r.reportingLabel, /3 of 83 counties/);
  console.log('    ', show(r));
});

t('FL 2026 staged file: counties summed, special, write-in dropped', () => {
  const [r] = S('fl').parse(fx('fl_enight_2026_subset.txt'));
  assert.strictEqual(r.special, true); assert.ok(r.candidates.some((c) => c.name === 'Ashley Moody' && c.party === 'GOP'));
  assert.match(r.reportingLabel, /precincts/);
  // Duplicate rows (seen in archive files) must not double-count
  const text = fx('fl_enight_2026_subset.txt').replace(/\t0\n/g, '\t100\n');
  const lines = text.trim().split('\n'); const dup = [...lines, lines[1]].join('\n');
  const once = S('fl').parse(text)[0], twice = S('fl').parse(dup)[0];
  assert.strictEqual(once.candidates[0].votes, twice.candidates[0].votes);
  console.log('    ', show(once));
});

t('MN ussenate.txt: 2024 real totals and 2026 staged file', () => {
  const [r] = S('mn').parse(fx('mn_ussenate_2024.txt'));
  const k = r.candidates[0]; assert.strictEqual(k.name, 'Amy Klobuchar'); assert.strictEqual(k.votes, 1792441); assert.strictEqual(k.party, 'Dem');
  assert.strictEqual(r.eevp, 100);
  const [r26] = S('mn').parse(fx('mn_ussenate_2026.txt'));
  assert.ok(r26.candidates.some((c) => c.name === 'Peggy Flanagan'));
  console.log('    ', show(r26));
});

t('AK precinct CSV (2026 primary file): names flipped, precincts counted, duplicates ignored', () => {
  const text = fx('ak_enr_2026primary_subset.csv');
  const [r] = S('ak').parse(text);
  assert.ok(r.candidates.some((c) => c.name === 'Dustin Thomas House Darden'));
  assert.match(r.reportingLabel, /first-choice/);
  const lines = text.trim().split('\n'); const [r2] = S('ak').parse([...lines, lines[1]].join('\n'));
  assert.strictEqual(r2.candidates.reduce((s, c) => s + c.votes, 0), r.candidates.reduce((s, c) => s + c.votes, 0));
});

t('NH, ME, NE report why they are not polled instead of failing silently', () => {
  assert.ok(S('nh').noLiveFeed); assert.ok(S('me').noLiveFeed); assert.ok(S('ne').noLiveFeed);
});

console.log(`test-states: ${n} checks passed`);
