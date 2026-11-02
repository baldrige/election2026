'use strict';
// North Carolina State Board of Elections — er.ncsbe.gov
// Statewide file results_0.txt is a JSON array (served as .txt), one row per candidate per contest; all values strings.
const { fetchJson, makeRace, toNum, normParty, isSpecial } = require('./helpers');

function parse(rows) {
  const senate = rows.filter((r) => r.cid === '0' && /^US SENATE/i.test(r.cnm || ''));
  const byContest = new Map();
  for (const r of senate) (byContest.get(r.cnm) || byContest.set(r.cnm, []).get(r.cnm)).push(r);
  return [...byContest.entries()].map(([name, rs]) => {
    const prt = toNum(rs[0].prt), ptl = toNum(rs[0].ptl);
    return makeRace({
      state: 'NC', special: isSpecial(name),
      candidates: rs.map((r) => ({ name: r.bnm, party: normParty(r.pty), votes: r.vct })),
      reporting: ptl ? (100 * prt) / ptl : null,
      reportingLabel: ptl ? `${prt.toLocaleString()} of ${ptl.toLocaleString()} precincts` : null,
    });
  });
}

module.exports = {
  sourceName: 'NC State Board of Elections',
  homepage: 'https://er.ncsbe.gov/',
  defaultUrl: 'https://er.ncsbe.gov/enr/{date}/data/results_0.txt',
  minIntervalSec: 30,
  parse,
  async fetch({ url }) { return parse(await fetchJson(url)); },
};
