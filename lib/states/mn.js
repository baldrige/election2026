'use strict';
// Minnesota Secretary of State — media results file ussenate.txt.
// Semicolon-delimited, no header; blank county/precinct means the row is already the statewide total.
const { fetchBuffer, makeRace, toNum, normParty, isSpecial } = require('./helpers');

function parse(text) {
  const rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(';'))
    .filter((f) => f[3] === '0102' && !f[1] && !f[2]);
  if (!rows.length) return [];
  const pr = toNum(rows[0][11]), pt = toNum(rows[0][12]);
  return [makeRace({
    state: 'MN', special: isSpecial(rows[0][4]),
    candidates: rows.filter((f) => f[10] !== 'WI').map((f) => ({ name: f[7], party: normParty(f[10]), votes: toNum(f[13]) })),
    reporting: pt ? (100 * pr) / pt : null,
    reportingLabel: pt ? `${pr.toLocaleString()} of ${pt.toLocaleString()} precincts` : null,
  })];
}

module.exports = {
  sourceName: 'Minnesota Secretary of State',
  homepage: 'https://electionresults.sos.mn.gov/',
  defaultUrl: 'https://electionresultsfiles.sos.mn.gov/{date}/ussenate.txt',
  minIntervalSec: 30,
  parse,
  async fetch({ url }) { return parse((await fetchBuffer(url)).toString('latin1')); }, // file is Windows-1252
};
