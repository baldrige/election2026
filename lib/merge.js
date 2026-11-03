'use strict';
// Senate merge rule: official state counts win while that state's feed is working; civicAPI fills in
// otherwise. A civicAPI call (winner flag) is carried over onto the official counts by party.
const { nameTokens } = require('./raceodds');

// The candidate in `cands` who matches the winner: unique by party, else by name within that party.
function winnerIn(cands, party, name) {
  const same = cands.filter((x) => x.party === party);
  if (same.length === 1) return same[0];
  const t = nameTokens(name || '');
  if (!t.length) return null;
  const last = t[t.length - 1], first = t[0];
  const pool = same.length ? same : cands;
  const tries = [
    (x) => nameTokens(x.name).join(' ') === t.join(' '),
    (x) => { const u = nameTokens(x.name); return u[u.length - 1] === last && u[0] && u[0][0] === first[0]; },
    (x) => { const u = nameTokens(x.name); return u[u.length - 1] === last; },
  ];
  for (const f of tries) { const m = pool.filter(f); if (m.length === 1) return m[0]; }
  return null;
}

function mergeSenate(stateRaces, civicRaces, feedOk) {
  const key = (r) => `${r.state}:${!!r.special}`;
  const fromState = new Map(stateRaces.map((r) => [key(r), r]));
  const out = [];
  for (const c of civicRaces) {
    const s = fromState.get(key(c));
    if (s && feedOk(s.state)) {
      fromState.delete(key(c));
      if (c.winnerParty) {
        // Official counts, call from civicAPI: mark the state's candidate who won. By party when only one
        // candidate has it; otherwise (e.g. Alaska's top-4 with two Republicans) by the winner's name.
        const w = c.candidates.find((x) => x.winner);
        const pick = winnerIn(s.candidates, c.winnerParty, w && w.name);
        if (pick) {
          s.candidates = s.candidates.map((x) => ({ ...x, winner: x === pick }));
          Object.assign(s, { winnerParty: c.winnerParty, calledBy: 'civicAPI', countsOnly: false });
        }
      }
      out.push(s);
    } else {
      if (s) fromState.delete(key(c)); // state feed failing: show civicAPI instead of stale state numbers
      out.push(c);
    }
  }
  return [...out, ...fromState.values()];
}

module.exports = { mergeSenate, winnerIn };
