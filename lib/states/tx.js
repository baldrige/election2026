'use strict';
// Texas Secretary of State — Civix ENR (goelect.txelections.civixapps.com). Sections are base64-encoded JSON.
const { fetchJson, makeRace, toNum, normParty, isSpecial } = require('./helpers');
const API = 'https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ElectionNightDashboard/1.0)',
  Origin: 'https://goelect.txelections.civixapps.com',
  Referer: 'https://goelect.txelections.civixapps.com/',
};
const b64json = (s) => (s ? JSON.parse(Buffer.from(s, 'base64').toString('utf8')) : null);

function parse(doc) {
  const fed = b64json(doc.Federal) || { Races: [] };
  const home = b64json(doc.Home) || {};
  const pl = home.PollingReporting || {};
  const plr = toNum(pl.PLR), plt = toNum(pl.PLT);
  return (fed.Races || []).filter((r) => /^U\.?\s*S\.?\s*SENAT/i.test((r.N || '').trim())).map((r) => {
    const cands = Array.isArray(r.Candidates) ? r.Candidates : Object.values(r.Candidates || {});
    return makeRace({
      state: 'TX', special: isSpecial(r.N),
      candidates: cands.filter((c) => c.P !== 'W').map((c) => ({ name: c.N, party: normParty(c.P), votes: c.V })), // P 'W' = declared write-in
      reporting: plt ? (100 * plr) / plt : null,
      reportingLabel: plt ? `${plr.toLocaleString()} of ${plt.toLocaleString()} polling places` : null,
      updated: home.LastUpdatedTime ? new Date(home.LastUpdatedTime + ' CST').toISOString() : null,
    });
  });
}

module.exports = {
  sourceName: 'Texas Secretary of State',
  homepage: 'https://goelect.txelections.civixapps.com/ivis-enr-ui/races',
  defaultUrl: `${API}/election/{electionId}`,
  minIntervalSec: 60,
  parse,
  async fetch({ url, entry }) {
    if (!entry.electionId) throw new Error('Set results.stateFeeds.TX.electionId (2026 general is 53815)');
    return parse(await fetchJson(url, { headers: HEADERS }));
  },
};
