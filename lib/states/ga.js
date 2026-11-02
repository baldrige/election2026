'use strict';
// Georgia Secretary of State — results.sos.ga.gov (Enhanced Voting platform)
// Whole-state export JSON. Election id is published near election day; discovered automatically by date.
const { fetchJson, makeRace, toNum, normParty, isSpecial } = require('./helpers');
const HOST = 'https://results.sos.ga.gov';

const isSenateItem = (name = '') => /^US Senate/i.test(name.split('/')[0].trim());
const cleanName = (n = '') => n.replace(/\s*\((I|Inc|Incumbent)\)\s*/gi, ' ').replace(/\s*\((Dem|Rep|Lib|Grn|Ind|NP|Np)\)\s*$/i, '').trim();

function parse(doc) {
  const items = (doc.results && doc.results.ballotItems) || [];
  return items.filter((b) => isSenateItem(b.name)).map((b) => {
    // Statewide precinct counts are null in the export; sum each county's numbers for this contest.
    let pr = toNum(b.precinctsReporting), pt = toNum(b.precinctsParticipating);
    if (!pt) {
      for (const l of doc.localResults || []) {
        const lb = (l.ballotItems || []).find((x) => x.id === b.id || x.name === b.name);
        if (lb) { pr += toNum(lb.precinctsReporting); pt += toNum(lb.precinctsParticipating); }
      }
    }
    return makeRace({
      state: 'GA', special: isSpecial(b.name),
      candidates: (b.ballotOptions || []).map((o) => ({ name: cleanName(o.name), party: normParty(o.politicalParty), votes: o.voteCount })),
      reporting: pt ? (100 * pr) / pt : null,
      reportingLabel: pt ? `${pr.toLocaleString()} of ${pt.toLocaleString()} precincts` : null,
    });
  });
}

let cachedId = null;
async function discoverId(electionDate) {
  if (cachedId) return cachedId;
  const j = await fetchJson(`${HOST}/results/public/api/jurisdictions/Georgia`);
  const same = (j.elections || []).filter((e) => String(e.electionDate).startsWith(electionDate));
  const pick = same.find((e) => /gen/i.test(e.publicElectionId) && !/runoff/i.test(e.publicElectionId)) || same[0];
  if (!pick) throw new Error(`Georgia hasn't published the ${electionDate} election yet (or set results.stateFeeds.GA.electionId)`);
  return (cachedId = pick.publicElectionId);
}

module.exports = {
  sourceName: 'Georgia Secretary of State',
  homepage: 'https://results.sos.ga.gov/',
  defaultUrl: `${HOST}/cdn/results/Georgia/export-{electionId}.json`,
  minIntervalSec: 60, // the export is large (~30 MB)
  parse,
  async fetch({ entry, electionDate }) {
    const id = entry.electionId || (await discoverId(electionDate));
    return parse(await fetchJson(`${HOST}/cdn/results/Georgia/export-${encodeURIComponent(id)}.json`));
  },
};
