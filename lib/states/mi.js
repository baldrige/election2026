'use strict';
// Michigan Bureau of Elections — mielections.us county results file (tab-delimited text despite .xls name).
// One row per candidate per county; summed here. The file has no precincts-reporting column.
const { fetchText, parseDelimited, makeRace, toNum, normParty, isSpecial } = require('./helpers');

function parse(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('ElectionDate\t'));
  if (start < 0) throw new Error('Michigan file has no header row');
  const body = lines.slice(start).filter((l) => !/^RECORDS:/.test(l)).join('\n');
  const rows = parseDelimited(body, '\t').filter((r) => /UNITED STATES SENATOR/i.test(r.OfficeDescription || ''));
  const byContest = new Map();
  for (const r of rows) {
    if ((r['WriteIn(W)/Uncommitted(Z)'] || '').trim()) continue;
    const k = r.OfficeDescription;
    (byContest.get(k) || byContest.set(k, []).get(k)).push(r);
  }
  return [...byContest.entries()].map(([desc, rs]) => {
    const counties = new Set(rs.map((r) => r.CountyCode)).size;
    return makeRace({
      state: 'MI', special: isSpecial(desc),
      candidates: rs.map((r) => ({
        name: [r.CandidateFirstName, r.CandidateMiddleName, r.CandidateLastName].filter(Boolean).join(' ').replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()),
        party: normParty(r.PartyDescription), votes: toNum(r.CandidateVotes),
      })),
      reporting: null,
      reportingLabel: `${counties} of 83 counties in file · no reporting % published`,
    });
  });
}

module.exports = {
  sourceName: 'Michigan Bureau of Elections',
  homepage: 'https://mielections.us/election/results/2026GEN_CENR.html',
  defaultUrl: 'https://mielections.us/election/results/DATA/2026GEN_MI_CENR_BY_COUNTY.xls',
  minIntervalSec: 60,
  parse,
  async fetch({ url }) {
    return parse(await fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElectionNightDashboard/1.0)' } }));
  },
};
