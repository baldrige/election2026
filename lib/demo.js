'use strict';
// DEMO MODE ONLY. Synthetic, obviously-fake data so the UI can be exercised without
// API keys or network access. Candidate names are placeholders; nothing here is real.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Mirrors live mode: one Senate race per state feed that has data (no calls), counts rising over time.
class DemoProvider {
  constructor(cfg) {
    const noFeed = new Set(['ME', 'NH', 'NE']);
    const states = Object.keys((cfg && cfg.results.stateFeeds) || {}).filter((s) => !noFeed.has(s));
    this.races = states.map((st) => ({
      st, special: st === 'OH' || st === 'FL', lean: rnd() * 0.2 - 0.1, eevp: 0, start: Date.now() + rnd() * 60000,
      votes: [0, 0, 0],
    }));
  }
  async fetch() {
    const now = Date.now();
    return this.races.map((r) => {
      if (now >= r.start && r.eevp < 98) {
        r.eevp = Math.min(98, r.eevp + 2 + rnd() * 5);
        const total = Math.round(r.eevp * 30000);
        const dem = 0.49 + r.lean + (rnd() - 0.5) * 0.03 * (100 - r.eevp) / 100;
        r.votes = [Math.round(total * dem), Math.round(total * (0.98 - dem)), Math.round(total * 0.02)];
      }
      const names = [['Demo Candidate A', 'Dem'], ['Demo Candidate B', 'GOP'], ['Demo Candidate C', 'Lib']];
      const sum = r.votes.reduce((a, b) => a + b, 0);
      const candidates = names.map(([name, party], i) => ({ name, party, votes: r.votes[i], pct: sum ? (100 * r.votes[i]) / sum : 0, winner: false }))
        .sort((a, b) => b.votes - a.votes);
      return {
        id: `demo:${r.st}`, state: r.st, office: 'S', district: null, special: r.special,
        title: `${r.st} · U.S. Senate${r.special ? ' (special)' : ''}`,
        eevp: r.eevp, reportingLabel: `${Math.round(r.eevp)}% of precincts (demo)`, lastUpdated: new Date().toISOString(),
        candidates, winnerParty: null, runoff: false, source: 'Demo data', sourceUrl: null, countsOnly: true,
      };
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
