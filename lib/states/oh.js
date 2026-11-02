'use strict';
// Ohio Secretary of State — liveresults.ohiosos.gov JSON API (always serves the current election).
// Detail rows are per county; statewide totals are summed here.
const { fetchJson, makeRace, toNum, normParty, isSpecial } = require('./helpers');
const API = 'https://liveresults.ohiosos.gov/Api/v1/Contest';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ElectionNightDashboard/1.0)', Accept: 'application/json' };

function findSenate(list) {
  const out = [];
  for (const parent of Array.isArray(list) ? list : list.contestList || []) {
    for (const g of parent.contestGroupings || []) {
      if (/^U\.?\s?S\.?\s+Senat/i.test(g.contestName || '')) out.push(g);
    }
  }
  return out;
}

function parse(detail, label = '') {
  const totals = new Map();
  let pr = 0, pt = 0;
  for (const county of detail.contestList || []) {
    pr += toNum(county.reportedPrecincts); pt += toNum(county.totalPrecincts);
    for (const c of county.candidatesRunning || []) {
      if (c.isWriteIn) continue;
      const k = c.primaryCandidate;
      const t = totals.get(k) || { name: k, party: normParty(c.candidateParty), votes: 0 };
      t.votes += c.vCount != null ? toNum(c.vCount) : toNum(c.voteCount);
      totals.set(k, t);
    }
  }
  const name = detail.contestDisplayName || label;
  return makeRace({
    state: 'OH', special: isSpecial(name),
    candidates: [...totals.values()],
    reporting: pt ? (100 * pr) / pt : null,
    reportingLabel: pt ? `${pr.toLocaleString()} of ${pt.toLocaleString()} precincts` : null,
  });
}

module.exports = {
  sourceName: 'Ohio Secretary of State',
  homepage: 'https://liveresults.ohiosos.gov/',
  defaultUrl: API,
  minIntervalSec: 60, // the site rate-limits automated clients (HTTP 429)
  parse, findSenate,
  async fetch() {
    const groups = findSenate(await fetchJson(`${API}/getContestList`, { headers: HEADERS }));
    if (!groups.length) return [];
    const races = [];
    for (const g of groups) {
      const d = await fetchJson(`${API}/GetContestDetailsObject?contestName=${encodeURIComponent(g.contestName)}&contestObjectId=${encodeURIComponent(g.contestObjectId)}&resultsLevel=&countyId=`, { headers: HEADERS });
      races.push(parse(d, g.displayName));
    }
    return races;
  },
};
