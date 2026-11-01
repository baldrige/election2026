'use strict';
// Vote tallies. Primary provider: Associated Press Elections API v3.
// Normalised race shape:
// { id, state, office:'S'|'H'|'G', title, district, eevp, lastUpdated,
//   candidates:[{name, party, votes, pct, winner}], winnerParty }
const { get } = require('./http');

const PARTY = { Dem: 'Dem', GOP: 'GOP', Rep: 'GOP', DFL: 'Dem', Ind: 'Ind', Lib: 'Lib', Grn: 'Grn' };
const normParty = (p) => PARTY[p] || p || 'Oth';

function normalizeApRace(r) {
  const ru = (r.reportingUnits || []).find((u) => u.level === 'state') || (r.reportingUnits || [])[0] || {};
  const cands = (ru.candidates || []).map((c) => ({
    name: [c.first, c.last].filter(Boolean).join(' '),
    party: normParty(c.party),
    votes: Number(c.voteCount) || 0,
    winner: c.winner === 'X',
    runoff: c.winner === 'R',
  }));
  const total = cands.reduce((s, c) => s + c.votes, 0);
  cands.forEach((c) => (c.pct = total ? (100 * c.votes) / total : 0));
  cands.sort((a, b) => b.votes - a.votes);
  const winner = cands.find((c) => c.winner);
  const district = r.seatNum ? `${r.statePostal}-${String(r.seatNum).padStart(2, '0')}` : null;
  return {
    id: String(r.raceID) + ':' + r.statePostal,
    state: r.statePostal,
    office: r.officeID,
    title: [r.statePostal, r.officeName, r.seatName].filter(Boolean).join(' · '),
    district,
    special: /special/i.test(r.raceType || '') || /unexpired/i.test(r.seatName || ''),
    eevp: ru.eevp != null ? Number(ru.eevp) : ru.precinctsReportingPct != null ? Number(ru.precinctsReportingPct) : null,
    lastUpdated: ru.lastUpdated || r.lastUpdated || null,
    candidates: cands,
    winnerParty: winner ? winner.party : null,
    runoff: cands.some((c) => c.runoff),
  };
}

class ApProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.key = process.env.AP_API_KEY;
    this.races = new Map();
    this.nextRequest = null;
  }
  get name() { return 'Associated Press'; }
  async fetch() {
    if (!this.key) throw new Error('AP_API_KEY is not set. Results need an AP Elections API key (see README).');
    const { apBaseUrl, offices } = this.cfg.results;
    // First call pulls everything; later calls use AP's `nextrequest` URL, which returns only changed races.
    const url = this.nextRequest ||
      `${apBaseUrl}/elections/${this.cfg.electionDate}?officeID=${offices.join(',')}&level=state&format=json&resultsType=l`;
    const data = await get(url, { headers: { 'x-api-key': this.key }, timeoutMs: 30000 });
    for (const r of data.races || []) {
      const n = normalizeApRace(r);
      this.races.set(n.id, n);
    }
    if (data.nextrequest) this.nextRequest = data.nextrequest;
    return [...this.races.values()];
  }
}

module.exports = { ApProvider, normalizeApRace };
