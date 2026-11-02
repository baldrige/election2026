'use strict';
// Florida Division of Elections — election-night flat file (tab-delimited, one row per candidate per county).
const { fetchText, parseDelimited, makeRace, toNum, normParty } = require('./helpers');

function parse(text) {
  const rows = parseDelimited(text, '\t');
  const seen = new Set();
  const senate = rows.filter((r) => {
    if (r.RaceCode !== 'USS') return false;
    const k = Object.values(r).join('\t'); // archive files contain exact duplicate rows
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  if (!senate.length) return [];
  const prec = new Map(); // county -> [reporting, total]
  for (const r of senate) prec.set(r.CountyCode, [toNum(r.PrecinctsReporting), toNum(r.Precincts)]);
  let pr = 0, pt = 0; for (const [a, b] of prec.values()) { pr += a; pt += b; }
  return [makeRace({
    state: 'FL', special: true, // the only 2026 FL Senate race is the special for the Rubio seat; name may not say so
    candidates: senate.filter((r) => !/write-?in/i.test(r.PartyName || '')).map((r) => ({
      name: [r.CanNameFirst, r.CanNameMiddle, r.CanNameLast].filter((x) => x && x.trim()).join(' '),
      party: normParty(r.PartyCode), votes: toNum(r.CanVotes),
    })),
    reporting: pt ? (100 * pr) / pt : null,
    reportingLabel: pt ? `${pr.toLocaleString()} of ${pt.toLocaleString()} precincts (${prec.size} counties in file)` : null,
  })];
}

module.exports = {
  sourceName: 'Florida Division of Elections',
  homepage: 'https://floridaelectionwatch.gov/',
  defaultUrl: 'https://flelectionfiles.floridados.gov/enightfilespublic/{date}_ElecResultsFL.txt',
  minIntervalSec: 30,
  parse,
  async fetch({ url }) {
    return parse(await fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElectionNightDashboard/1.0)' } }));
  },
};
