'use strict';
// Saves what can't be refetched (market trend history, the race-call log, which calls were already
// seen) so a restart or redeploy doesn't wipe it. Written atomically every minute and on shutdown.
const fs = require('fs');
const path = require('path');

const VERSION = 1;

// History arrays carry a .label property, which JSON drops; store it explicitly.
function packHistory(history) {
  return Object.fromEntries(Object.entries(history).map(([k, h]) => [k, { label: h.label || null, pts: h.slice() }]));
}
function unpackHistory(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!v || !Array.isArray(v.pts)) continue;
    const h = v.pts.filter((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (v.label) h.label = v.label;
    out[k] = h;
  }
  return out;
}

function save(file, { electionDate, calls, calledSeen, history }) {
  const snap = { v: VERSION, electionDate, savedAt: Date.now(), calls, calledSeen: [...calledSeen], history: packHistory(history) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap));
  fs.renameSync(tmp, file); // atomic: a crash mid-write never leaves a half-written file
  return snap.savedAt;
}

// Returns { calls, calledSeen: Map, history, savedAt } or { skipped: reason }.
function load(file, { electionDate }) {
  let snap;
  try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { skipped: e.code === 'ENOENT' ? 'no saved state yet' : `saved state unreadable (${e.message}); starting fresh` }; }
  if (!snap || snap.v !== VERSION) return { skipped: 'saved state is from another version; starting fresh' };
  if (snap.electionDate !== electionDate) return { skipped: `saved state is for ${snap.electionDate}, not ${electionDate}; starting fresh` };
  return {
    calls: Array.isArray(snap.calls) ? snap.calls : [],
    calledSeen: new Map(Array.isArray(snap.calledSeen) ? snap.calledSeen : []),
    history: unpackHistory(snap.history),
    savedAt: snap.savedAt,
  };
}

module.exports = { save, load, packHistory, unpackHistory };
