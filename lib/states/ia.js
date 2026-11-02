'use strict';
// Iowa Secretary of State — Clarity/Scytl ENR (electionresults.iowa.gov -> results.enr.clarityelections.com/IA/)
const { fetchText, fetchJson, makeRace, toNum, normParty, isSpecial } = require('./helpers');
const BASE = 'https://results.enr.clarityelections.com/IA';

// Clarity summary.json: array of contests with parallel arrays CH (names), P (parties), V (votes).
function parseClarity(contests, state) {
  return contests.filter((c) => /^United States Senat/i.test(c.C || '')).map((c) => {
    const pr = toNum(c.PR), tp = toNum(c.TP);
    return makeRace({
      state, special: isSpecial(c.C),
      candidates: (c.CH || []).map((name, i) => ({ name, party: normParty((c.P || [])[i]), votes: (c.V || [])[i] })),
      reporting: tp ? (100 * pr) / tp : null,
      // Clarity counts a unit as reporting once it uploads any file (even a blank pre-election one).
      reportingLabel: tp ? `${pr} of ${tp} ${tp < 200 ? 'counties' : 'precincts'} reporting` : null,
    });
  });
}

module.exports = {
  sourceName: 'Iowa Secretary of State',
  homepage: 'https://electionresults.iowa.gov/',
  defaultUrl: `${BASE}/{electionId}`,
  minIntervalSec: 30,
  parse: (d) => parseClarity(d, 'IA'),
  parseClarity,
  async fetch({ entry }) {
    if (!entry.electionId) throw new Error('Set results.stateFeeds.IA.electionId (2026 general is 127077)');
    const ver = (await fetchText(`${BASE}/${entry.electionId}/current_ver.txt`)).trim();
    return parseClarity(await fetchJson(`${BASE}/${entry.electionId}/${ver}/json/en/summary.json`), 'IA');
  },
};
