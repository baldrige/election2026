'use strict';
// civicAPI (https://civicapi.org): free, keyless US results for Senate, Governor and House races.
// Licence: free to use; ATTRIBUTION REQUIRED ("civicAPI (civicapi.org)" with a link) wherever its numbers appear.
// It is a small independent project; its data and winner flags are shown labelled as such, and official
// state counts take precedence where we have them.
const { normParty, isSpecial, toNum } = require('./states/helpers');
const { summarize } = require('./http');

const NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const TYPE = { S: 'US Senate', G: 'Governor' };
const OFFICE_LABEL = { S: 'U.S. Senate', G: 'Governor', H: 'U.S. House' };
const SOURCE = 'civicAPI (civicapi.org)';
const HOME = 'https://civicapi.org';

function normCandidates(list = []) {
  const c = list.filter((x) => x && x.name && !/write[\s-]?in/i.test(x.name)).map((x) => ({
    name: String(x.name).trim(), party: normParty(x.party), votes: toNum(x.votes), winner: x.winner === true,
  }));
  const total = c.reduce((s, x) => s + x.votes, 0);
  const rank = (x) => (x.party === 'Dem' || x.party === 'GOP' ? 0 : 1);
  c.forEach((x) => (x.pct = total ? (100 * x.votes) / total : 0));
  return c.sort((a, b) => b.votes - a.votes || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function makeRace({ id, state, office, district = null, special = false, pr, updated, candidates, useWinners }) {
  const cands = useWinners ? candidates : candidates.map((c) => ({ ...c, winner: false }));
  const w = cands.find((c) => c.winner);
  return {
    id, state, office, district, special,
    title: `${district || state} · ${OFFICE_LABEL[office]}${special ? ' (special)' : ''}`,
    eevp: pr == null ? null : toNum(pr),
    reportingLabel: pr == null ? null : `${Math.round(toNum(pr))}% reporting (civicAPI)`,
    lastUpdated: updated || null, candidates: cands, winnerParty: w ? w.party : null, runoff: false,
    source: SOURCE, sourceUrl: HOME, countsOnly: !useWinners, calledBy: w ? 'civicAPI' : null,
  };
}

// One statewide race document -> dashboard race.
function parseRace(doc, office, useWinners = true) {
  return makeRace({
    id: `civic:${office}:${doc.province}${isSpecial(doc.election_name) ? ':special' : ''}`,
    state: doc.province, office, special: isSpecial(doc.election_name), pr: doc.percent_reporting,
    updated: doc.last_updated, candidates: normCandidates(doc.candidates), useWinners,
  });
}

// The House document carries all 435 districts in region_results, keyed "az-01" / "ak-al".
function parseHouse(doc, useWinners = true) {
  const out = [];
  for (const [key, v] of Object.entries(doc.region_results || {})) {
    const m = /^([a-z]{2})-(\d+|al)$/i.exec(key);
    if (!m) continue;
    const st = m[1].toUpperCase(), dist = `${st}-${m[2].toUpperCase().padStart(2, '0')}`;
    out.push(makeRace({ id: `civic:H:${dist}`, state: st, office: 'H', district: dist, pr: v.percent_reporting,
      updated: doc.last_updated, candidates: normCandidates(v.candidates), useWinners }));
  }
  return out;
}

// Does this document describe the race we asked for? (Guards against ids that get reassigned.)
function mismatch(doc, want, electionDate) {
  if (!doc || !Array.isArray(doc.candidates)) return 'not a race document';
  if (!String(doc.election_date || '').startsWith(electionDate)) return `date ${doc.election_date}`;
  if (want.office === 'H') return /house/i.test(`${doc.election_type} ${doc.election_name}`) ? null : 'not the House race';
  if (doc.province !== want.state) return `state ${doc.province}`;
  if (doc.election_type !== TYPE[want.office]) return `type ${doc.election_type}`;
  return null;
}

class CivicApiProvider {
  constructor(cfg, { now = () => Date.now() } = {}) {
    this.cfg = cfg; this.c = cfg.civicapi; this.now = now;
    this.base = this.c.baseUrl.replace(/\/$/, '');
    this.useWinners = this.c.useWinnerFlags !== false;
    this.races = [];   // {key, office, state, id, etag, doc, error, resolvedAt}
    const seeds = this.c.raceIds || {};
    for (const st of this.c.senateStates || []) this.races.push({ key: `S:${st}`, office: 'S', state: st, id: seeds[`S:${st}`] || null });
    for (const st of this.c.governorStates || []) this.races.push({ key: `G:${st}`, office: 'G', state: st, id: seeds[`G:${st}`] || null });
    if (this.c.house !== false) this.races.push({ key: 'H', office: 'H', state: 'US', id: this.c.houseRaceId || null });
    this.i = 0; this.pausedUntil = 0; this.timer = null; this.lastError = null; this.cycleOk = 0;
  }

  async request(path, headers = {}) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(this.base + path, { headers: { 'User-Agent': 'ElectionNightDashboard/1.0 (personal; polite polling ~1 req/s)', Accept: 'application/json', ...headers }, signal: ctrl.signal });
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get('retry-after'));
        this.pausedUntil = this.now() + 1000 * Math.max(Number.isFinite(ra) ? ra : 0, 120);
        throw new Error(`rate-limited (HTTP ${res.status}); pausing all civicAPI requests`);
      }
      if (res.status === 304) return { notModified: true };
      if (!res.ok) throw new Error(`HTTP ${res.status} (${summarize(await res.text().catch(() => ''))})`);
      return { json: await res.json(), etag: res.headers.get('etag') };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('timed out');
      throw e;
    } finally { clearTimeout(t); }
  }

  async resolve(r) {
    if (r.office === 'H') throw new Error('Set civicapi.houseRaceId in config.json');
    const q = `${NAMES[r.state]} ${TYPE[r.office]}`;
    const { json } = await this.request(`/race/search?query=${encodeURIComponent(q)}&date=${this.cfg.electionDate}`);
    const hits = (json.races || []).filter((x) => x.province === r.state && x.election_type === TYPE[r.office]
      && String(x.election_date || '').startsWith(this.cfg.electionDate) && !/primary/i.test(x.election_name || ''));
    r.resolvedAt = this.now();
    if (!hits.length) throw new Error(`no ${q} race listed for ${this.cfg.electionDate} yet`);
    r.id = hits[0].id;
  }

  // Poll exactly one race (round-robin). Called on a fixed timer so load stays ~requestsPerSecond.
  async step() {
    if (!this.races.length || this.now() < this.pausedUntil) return;
    // The House is one request covering all 435 districts, so it gets every 4th slot.
    const house = this.races.find((x) => x.office === 'H');
    const others = this.races.filter((x) => x !== house);
    let r;
    if (house && (this.i % 4 === 0 || !others.length)) r = house;
    else { this.j = ((this.j ?? -1) + 1) % others.length; r = others[this.j]; }
    this.i++;
    try {
      if (!r.id) {
        if (r.resolvedAt && this.now() - r.resolvedAt < 10 * 60 * 1000) return; // re-search unresolved races every 10 min
        await this.resolve(r);
        return; // fetch on its next turn
      }
      const res = await this.request(`/race/${r.id}`, r.etag ? { 'If-None-Match': r.etag } : {});
      if (res.notModified) { r.error = null; r.checkedAt = this.now(); return; }
      const bad = mismatch(res.json, r, this.cfg.electionDate);
      if (bad) { r.id = null; r.doc = null; r.etag = null; throw new Error(`race id no longer matches (${bad}); searching again`); }
      if (res.json.test_data) { r.doc = null; throw new Error('civicAPI marks this race as test data; hidden'); }
      r.doc = res.json; r.etag = res.etag; r.error = null; r.checkedAt = this.now();
    } catch (e) {
      r.error = e.message;
    }
  }

  start() {
    const every = 1000 / Math.max(0.1, this.c.requestsPerSecond || 1);
    const tick = () => this.step().catch(() => {}).finally(() => { this.timer = setTimeout(tick, every); });
    tick();
  }

  // Current races from whatever documents we hold.
  results() {
    const out = [];
    for (const r of this.races) {
      if (!r.doc) continue;
      try { if (r.office === 'H') out.push(...parseHouse(r.doc, this.useWinners)); else out.push(parseRace(r.doc, r.office, this.useWinners)); }
      catch (e) { r.error = `could not read document: ${e.message}`; }
    }
    return out;
  }

  status() {
    const have = this.races.filter((r) => r.doc).length;
    const errs = this.races.filter((r) => r.error).map((r) => `${r.key}: ${r.error}`);
    const paused = this.now() < this.pausedUntil ? ` · paused ${Math.ceil((this.pausedUntil - this.now()) / 1000)} s after a rate limit` : '';
    return { ok: have > 0, have, total: this.races.length, errors: errs.slice(0, 3), errorCount: errs.length,
      message: `${have} of ${this.races.length} races loaded (Senate, Governor${this.c.house !== false ? ', House' : ''})${paused}` };
  }
}

module.exports = { CivicApiProvider, parseRace, parseHouse, normCandidates, mismatch, NAMES, SOURCE, HOME };
