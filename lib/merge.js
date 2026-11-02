'use strict';
// Senate merge rule: official state counts win while that state's feed is working; civicAPI fills in
// otherwise. A civicAPI call (winner flag) is carried over onto the official counts by party.
function mergeSenate(stateRaces, civicRaces, feedOk) {
  const key = (r) => `${r.state}:${!!r.special}`;
  const fromState = new Map(stateRaces.map((r) => [key(r), r]));
  const out = [];
  for (const c of civicRaces) {
    const s = fromState.get(key(c));
    if (s && feedOk(s.state)) {
      fromState.delete(key(c));
      if (c.winnerParty) {
        // Official counts, call from civicAPI: mark the state's candidate of the winning party.
        const match = s.candidates.filter((x) => x.party === c.winnerParty);
        if (match.length === 1) {
          s.candidates = s.candidates.map((x) => ({ ...x, winner: x === match[0] }));
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

module.exports = { mergeSenate };
