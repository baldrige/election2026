'use strict';
// DEMO MODE ONLY. Synthetic, obviously-fake data so the UI can be exercised without
// API keys or network access. Candidate names are placeholders; nothing here is real.
const STATES = ['AK','AL','AR','AZ','CA','CO','CT','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY'];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function makeRaces() {
  const races = [];
  const mk = (office, state, district, lean) => ({
    id: `demo-${office}-${district || state}`, state, office, district,
    title: `${district || state} · ${{ S: 'U.S. Senate', H: 'U.S. House', G: 'Governor' }[office]}`,
    lean, eevp: 0, candidates: [
      { name: 'Demo Candidate A', party: 'Dem', votes: 0 },
      { name: 'Demo Candidate B', party: 'GOP', votes: 0 },
    ], start: Date.now() + rnd() * 120000,
  });
  STATES.slice(0, 35).forEach((s) => races.push(mk('S', s, null, rnd() * 0.3 - 0.15)));
  STATES.slice(10, 46).forEach((s) => races.push(mk('G', s, null, rnd() * 0.3 - 0.15)));
  for (let i = 0; i < 435; i++) {
    const s = STATES[i % 50];
    races.push(mk('H', s, `${s}-${String(Math.floor(i / 50) + 1).padStart(2, '0')}`, rnd() * 0.6 - 0.3));
  }
  return races;
}

class DemoProvider {
  constructor() { this.races = makeRaces(); }
  get name() { return 'DEMO DATA (not real)'; }
  async fetch() {
    const now = Date.now();
    for (const r of this.races) {
      if (now < r.start || r.eevp >= 99) continue;
      r.eevp = Math.min(99, r.eevp + 2 + rnd() * 6);
      const total = Math.round(r.eevp * 4000);
      const dem = 0.5 + r.lean + (rnd() - 0.5) * 0.04 * (100 - r.eevp) / 100;
      r.candidates[0].votes = Math.round(total * dem);
      r.candidates[1].votes = total - r.candidates[0].votes;
      const margin = Math.abs(2 * dem - 1);
      if (!r.winnerParty && r.eevp > 30 && margin * r.eevp > 6) {
        const w = dem > 0.5 ? 0 : 1;
        r.candidates[w].winner = true;
        r.winnerParty = r.candidates[w].party;
      }
      r.lastUpdated = new Date().toISOString();
    }
    return this.races.map((r) => {
      const total = r.candidates.reduce((s, c) => s + c.votes, 0);
      const candidates = r.candidates
        .map((c) => ({ ...c, winner: !!c.winner, pct: total ? (100 * c.votes) / total : 0 }))
        .sort((a, b) => b.votes - a.votes);
      return { ...r, candidates, start: undefined, lean: undefined };
    });
  }
}

let drift = 0.55;
function demoMarkets() {
  drift = Math.min(0.97, Math.max(0.03, drift + (rnd() - 0.5) * 0.04));
  const m = (key, source, title, p) => ({ key, source, title: `[DEMO] ${title}`, url: '#', volume: null,
    outcomes: [{ label: 'Democrats', prob: p }, { label: 'Republicans', prob: 1 - p }].sort((a, b) => b.prob - a.prob) });
  return { markets: [
    m('demo:k-h', 'Kalshi', 'House control', drift),
    m('demo:p-h', 'Polymarket', 'House control', drift + 0.02),
    m('demo:k-s', 'Kalshi', 'Senate control', 1 - drift),
    m('demo:p-s', 'Polymarket', 'Senate control', 1 - drift - 0.03),
  ], errors: [] };
}

function demoNews() {
  const now = Date.now();
  return { errors: [], items: Array.from({ length: 12 }, (_, i) => ({
    source: ['Demo Wire', 'Sample Times', 'Placeholder News'][i % 3],
    title: `[DEMO] Placeholder headline #${12 - i} — real headlines appear when feeds are reachable`,
    link: '#', summary: 'This is synthetic text used to test the layout.', ts: now - i * 7 * 60000,
  })) };
}

module.exports = { DemoProvider, demoMarkets, demoNews };
