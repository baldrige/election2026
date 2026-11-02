'use strict';
// Alaska Division of Elections — precinct-level CSV. Election night shows FIRST-CHOICE votes only;
// ranked-choice rounds are run after the count finishes (about two weeks later).
const { fetchText, parseDelimited, makeRace, toNum, normParty, isSpecial } = require('./helpers');

function parse(text) {
  const rows = parseDelimited(text, ',').filter((r) => /^U\.?\s?S\.?\s+Senat/i.test(r.Contest_title || ''));
  const seen = new Set(), pcts = new Map(), totals = new Map();
  for (const r of rows) {
    const k = `${r.Pct_Id}|${r.Contest_Id}|${r.candidate_id}`;
    if (seen.has(k)) continue; seen.add(k); // published files contain duplicate rows
    pcts.set(r.Pct_Id, r.Reporting_flag === '1');
    if (/write/i.test(r.candidate_name || '') || r.Candidate_Type === 'W') continue;
    const t = totals.get(r.candidate_id) || { name: r.candidate_name.replace(/^([^,]+),\s*(.+)$/, '$2 $1'), party: normParty(r.Party_Code), votes: 0 };
    t.votes += toNum(r.total_votes);
    totals.set(r.candidate_id, t);
  }
  if (!totals.size) return [];
  // The /enr26/ file held the August top-4 primary (16 Senate candidates) in late October. A general
  // election has at most four finalists plus write-ins, so a long list means the primary is still up.
  if (totals.size > 6) throw new Error(`Alaska's results file still shows the primary (${totals.size} Senate candidates); waiting for the general-election file`);
  const rep = [...pcts.values()].filter(Boolean).length;
  return [makeRace({
    state: 'AK', special: isSpecial(rows[0].Contest_title),
    candidates: [...totals.values()],
    reporting: pcts.size ? (100 * rep) / pcts.size : null,
    reportingLabel: `${rep} of ${pcts.size} precincts · first-choice votes (ranked-choice count later)`,
  })];
}

module.exports = {
  sourceName: 'Alaska Division of Elections',
  homepage: 'https://www.elections.alaska.gov/',
  defaultUrl: 'https://www.elections.alaska.gov/enr26/results/GA_ENR_Precinct_State_of_Alaska.csv',
  minIntervalSec: 60,
  parse,
  async fetch({ url }) {
    try { return parse(await fetchText(url)); }
    catch (e) {
      if (/certificate|UNABLE_TO_VERIFY/i.test(e.message + (e.cause?.code || '')))
        throw new Error('Alaska\'s server sends an incomplete TLS certificate chain. See README "Alaska certificate" to add the missing intermediate via NODE_EXTRA_CA_CERTS.');
      throw e;
    }
  },
};
