'use strict';
// DEMO MODE ONLY. Synthetic, obviously-fake data so the UI can be exercised without
// API keys or network access. Candidate names are placeholders; nothing here is real.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Mirrors live mode: Senate (state feeds + civicAPI), Governor and House races; counts rise, some get "called".
class DemoProvider {
  constructor(cfg) {
    const c = (cfg && cfg.civicapi) || {};
    const mk = (office, st, district, special) => ({ office, st, district, special, lean: rnd() * 0.3 - 0.15, eevp: 0,
      start: Date.now() + rnd() * 90000, votes: [0, 0, 0], winner: null });
    this.races = [
      ...(c.senateStates || []).map((st) => mk('S', st, null, st === 'OH' || st === 'FL')),
      ...(c.governorStates || []).map((st) => mk('G', st, null, false)),
    ];
    const seats = { CA: 52, TX: 38, FL: 28, NY: 26, PA: 17, IL: 17, OH: 15, GA: 14, NC: 14, MI: 13, NJ: 12, VA: 11, WA: 10, AZ: 9, IN: 9, MA: 9, TN: 9 };
    const all = Object.keys(require('./civicapi').NAMES);
    let n = 0; const house = [];
    for (const st of all) { const k = seats[st] || (n % 3 === 0 ? 1 : n % 3 === 1 ? 4 : 6); n++; for (let i = 1; i <= k; i++) house.push([st, k === 1 ? `${st}-AL` : `${st}-${String(i).padStart(2, '0')}`]); }
    for (let i = 53; house.length < 435; i++) house.push(['CA', `CA-${i}`]); // pad to 435 (demo only)
    house.slice(0, 435).forEach(([st, d]) => this.races.push(mk('H', st, d, false)));
  }
  async fetch() {
    const now = Date.now();
    const names = { S: 'U.S. Senate', G: 'Governor', H: 'U.S. House' };
    return this.races.map((r) => {
      if (now >= r.start && r.eevp < 98) {
        r.eevp = Math.min(98, r.eevp + 3 + rnd() * 6);
        const total = Math.round(r.eevp * (r.office === 'H' ? 3000 : 30000));
        const dem = 0.49 + r.lean + (rnd() - 0.5) * 0.03 * (100 - r.eevp) / 100;
        r.votes = [Math.round(total * dem), Math.round(total * (0.98 - dem)), Math.round(total * 0.02)];
        if (!r.winner && r.eevp > 40 && Math.abs(2 * dem - 1) * r.eevp > 8) r.winner = dem > 0.5 ? 'Dem' : 'GOP';
      }
      const sum = r.votes.reduce((a, b) => a + b, 0);
      const candidates = [['Demo Candidate A', 'Dem'], ['Demo Candidate B', 'GOP'], ['Demo Candidate C', 'Lib']]
        .map(([name, party], i) => ({ name, party, votes: r.votes[i], pct: sum ? (100 * r.votes[i]) / sum : 0, winner: party === r.winner }))
        .sort((a, b) => b.votes - a.votes);
      return {
        id: `demo:${r.office}:${r.district || r.st}`, state: r.st, office: r.office, district: r.district, special: r.special,
        title: `${r.district || r.st} · ${names[r.office]}${r.special ? ' (special)' : ''}`,
        eevp: r.eevp, reportingLabel: `${Math.round(r.eevp)}% reporting (demo)`, lastUpdated: new Date().toISOString(),
        candidates, winnerParty: r.winner, runoff: false, source: 'Demo data', sourceUrl: null, calledBy: r.winner ? 'demo' : null,
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
    m('demo:pi-s', 'PredictIt', 'Which party will control the Senate?', 1 - drift + 0.02),
    { ...m('demo:k-ga', 'Kalshi', 'Georgia Senate race', 0.5 + (drift - 0.5) / 2), volume: 120000 },
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
