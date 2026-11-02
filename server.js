'use strict';
// Election night dashboard server. Zero dependencies; Node 18+.
//   node server.js            -> live mode (official state results, markets, news)
//   DEMO=1 node server.js     -> synthetic data, for testing the UI
const http = require('http');
const fs = require('fs');
const path = require('path');
const { StateFeedsProvider } = require('./lib/statefeeds');
const { CivicApiProvider } = require('./lib/civicapi');
const { mergeSenate } = require('./lib/merge');
const { RaceOddsProvider } = require('./lib/raceodds');
const persist = require('./lib/persist');
const markets = require('./lib/markets');
const news = require('./lib/news');
const demo = require('./lib/demo');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DEMO = process.env.DEMO === '1';
const PORT = Number(process.env.PORT) || cfg.port || 8080;
// Optional password protection (HTTP Basic auth). Set DASHBOARD_PASSWORD on the host; any username works.
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const crypto = require('crypto');
function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const pw = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

const state = {
  results: { races: [], provider: null, updated: null, error: null, feeds: [] },
  calls: [], // race-call log (civicAPI winner flags), newest first
  markets: { groups: [], markets: [], errors: [], updated: null, history: {} },
  news: { items: [], errors: [], updated: null },
};

// ---------- results ----------
// Senate: official state websites first (counts), civicAPI where a state has no working feed.
// Governor and House: civicAPI. Calls come only from civicAPI's winner flags and are labelled as such.
const provider = DEMO ? new demo.DemoProvider(cfg) : new StateFeedsProvider(cfg);
const civic = !DEMO && cfg.civicapi && cfg.civicapi.enabled ? new CivicApiProvider(cfg) : null;
if (civic) civic.start();
const raceOdds = !DEMO && cfg.markets.raceMarkets ? new RaceOddsProvider(cfg) : null;
if (raceOdds) raceOdds.start();

const calledSeen = new Map();
const startedAt = Date.now();
const WARMUP_MS = 150 * 1000; // first full civicAPI cycle; calls seen then already existed, so they aren't logged as new

// ---------- saved state (survives restarts and redeploys) ----------
// On Render, STATE_DIR points at a persistent disk (see render.yaml). Locally it defaults to ./data.
const STATE_FILE = path.join(process.env.STATE_DIR || path.join(__dirname, 'data'), 'dashboard-state.json');
let restored = null;
if (!DEMO) {
  const r = persist.load(STATE_FILE, { electionDate: cfg.electionDate });
  if (r.skipped) console.log(`  saved state: ${r.skipped}`);
  else {
    restored = r;
    state.calls = r.calls;
    for (const [k, v] of r.calledSeen) calledSeen.set(k, v);
    state.markets.history = r.history;
    console.log(`  saved state: restored ${r.calls.length} calls and ${Object.keys(r.history).length} market histories from ${new Date(r.savedAt).toISOString()}`);
  }
}
function saveState() {
  if (DEMO) return;
  try { persist.save(STATE_FILE, { electionDate: cfg.electionDate, calls: state.calls, calledSeen, history: state.markets.history }); }
  catch (e) { console.error('[persist] could not save state:', e.message); }
}
setInterval(saveState, 60 * 1000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { saveState(); process.exit(0); }); // Render sends SIGTERM on deploy
function logCalls(races) {
  for (const r of races) {
    if (!r.winnerParty || calledSeen.get(r.id) === r.winnerParty) continue;
    const changed = calledSeen.has(r.id);
    calledSeen.set(r.id, r.winnerParty);
    // Without saved state, calls seen during warm-up already existed at startup: don't log them as new.
    // With saved state we know what was already called, so log them, marked as found after a restart.
    const warm = Date.now() - startedAt < WARMUP_MS;
    if (warm && !restored) continue;
    const w = r.candidates.find((c) => c.winner);
    state.calls.unshift({ ts: Date.now(), id: r.id, title: r.title, office: r.office, winner: w ? w.name : '',
      party: r.winnerParty, changed, by: r.calledBy || '', ...(warm ? { afterRestart: true } : {}) });
  }
  state.calls = state.calls.slice(0, 300);
}

function placeholders(races, feeds) {
  const have = new Set(races.map((r) => `${r.office}:${r.state}`));
  const feedBy = new Map(feeds.map((f) => [f.state, f]));
  const out = [];
  for (const [office, list] of [['S', (cfg.civicapi || {}).senateStates || []], ['G', (cfg.civicapi || {}).governorStates || []]]) {
    for (const st of list) {
      if (have.has(`${office}:${st}`)) continue;
      const why = [];
      const f = office === 'S' && feedBy.get(st);
      if (f && !f.ok) why.push(`State site: ${f.message}`);
      if (civic) why.push(`civicAPI: ${civic.raceError(office, st) || 'no data'}`);
      out.push({ id: `pending:${office}:${st}`, state: st, office, district: null, special: st === 'OH' && office === 'S' || st === 'FL' && office === 'S',
        title: `${st} · ${office === 'S' ? 'U.S. Senate' : 'Governor'}`, candidates: [], winnerParty: null, pending: true, pendingWhy: why });
    }
  }
  return out;
}

async function pollResults() {
  try {
    const stRaces = await provider.fetch();
    let races = stRaces;
    const feeds = DEMO ? [] : provider.feedStatus();
    if (civic) {
      const ok = new Set(feeds.filter((f) => f.ok).map((f) => f.state));
      const cr = civic.results();
      races = [...mergeSenate(stRaces, cr.filter((r) => r.office === 'S'), (st) => ok.has(st)), ...cr.filter((r) => r.office !== 'S')];
      const cs = civic.status();
      feeds.push({ state: 'civicAPI', ok: cs.ok, message: cs.message + (cs.errorCount ? ` · ${cs.errorCount} not available yet (e.g. ${cs.errors.join('; ')})` : ''), url: 'https://civicapi.org', updated: cs.ok ? Date.now() : null });
    }
    // Every Senate/Governor race on the ballot gets a card, even without results, with the reason.
    if (!DEMO) races = [...races, ...placeholders(races, feeds)];
    logCalls(races);
    if (raceOdds) {
      raceOdds.setRaces(races);
      feeds.push({ state: 'Race odds', ok: true, info: false, message: `Kalshi: ${raceOdds.status.Kalshi} · Polymarket: ${raceOdds.status.Polymarket}`, url: null });
    }
    Object.assign(state.results, {
      races, provider: DEMO ? 'DEMO DATA (not real)' : civic ? 'official state election websites + civicAPI' : 'official state election websites',
      updated: races.length ? Date.now() : state.results.updated, error: null, feeds, civic: !!civic,
    });
  } catch (e) {
    state.results.error = e.message;
    console.error('[results]', e.message);
  }
}

// ---------- markets ----------
async function pollMarkets() {
  try {
    const { markets: list, errors } = DEMO ? demo.demoMarkets() : await markets.fetchAll(cfg.markets);
    const now = Date.now();
    const { groups, others } = markets.groupMarkets(list, cfg.markets.groups);
    const push = (key, label, p) => {
      const h = (state.markets.history[key] ||= []);
      h.label ||= label;
      if (h.label === label && p != null) h.push([now, p]);
      if (h.length > 1440) h.splice(0, h.length - 1440); // 24 h at one point a minute
    };
    // Grouped (two-party) markets: track the Democratic probability, per platform and averaged.
    for (const g of groups) {
      push(`group:${g.key}`, 'Dem', g.dem);
      for (const r of g.rows) if (!r.stale) push(r.key, 'Dem', r.dem);
    }
    // Other markets: track the first outcome label we saw so the line doesn't flip between outcomes.
    for (const m of others) {
      const h = state.markets.history[m.key];
      const label = (h && h.label) || (m.outcomes[0] || {}).label;
      const o = m.outcomes.find((x) => x.label === label);
      if (o && !m.stale) push(m.key, label, o.prob);
    }
    Object.assign(state.markets, { groups, markets: others, errors, updated: now });
  } catch (e) {
    state.markets.errors = [e.message];
  }
}

// ---------- news ----------
async function pollNews() {
  const { items, errors } = DEMO ? demo.demoNews() : await news.fetchAll(cfg.news);
  Object.assign(state.news, { items, errors, updated: Date.now() });
}

function loop(fn, seconds) {
  const run = () => fn().catch((e) => console.error(e)).finally(() => setTimeout(run, seconds * 1000));
  run();
}
loop(pollResults, DEMO ? 5 : cfg.results.pollSeconds);
loop(pollMarkets, DEMO ? 5 : cfg.markets.pollSeconds);
loop(pollNews, DEMO ? 30 : cfg.news.pollSeconds);

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/healthz') return send(res, 200, { ok: true });
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Election Night Desk", charset="UTF-8"', 'Content-Type': 'text/plain' });
    return res.end('Password required');
  }
  if (p === '/api/state') {
    return send(res, 200, {
      demo: DEMO,
      now: Date.now(),
      config: {
        electionDate: cfg.electionDate,
        senateHoldovers: cfg.results.senateHoldovers,
        // Every state with a 2026 Senate/Governor race, so the map shows them all even before results load.
        raceStates: { S: (cfg.civicapi || {}).senateStates || [], G: (cfg.civicapi || {}).governorStates || [] },
      },
      results: { ...state.results, races: state.results.races.map((r) => {
        const odds = DEMO ? demo.demoRaceOdds(r) : raceOdds ? raceOdds.forRace(r) : null;
        return odds ? { ...r, odds } : r;
      }) },
      calls: state.calls,
      // Odds for every configured Senate/Governor race, keyed "S:TX" (the map uses these when a race has no results yet).
      mapOdds: Object.fromEntries(['S', 'G'].flatMap((o) => ((cfg.civicapi || {})[o === 'S' ? 'senateStates' : 'governorStates'] || [])
        .map((st) => [`${o}:${st}`, DEMO ? demo.demoRaceOdds({ office: o, state: st }) : raceOdds ? raceOdds.forKey(`${o}:${st}`) : null]))
        .filter(([, v]) => v)),
      markets: state.markets,
      news: state.news,
    });
  }
  const file = path.normalize(path.join(__dirname, 'public', p === '/' ? 'index.html' : p));
  if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`Election dashboard on http://localhost:${PORT}${DEMO ? '  (DEMO DATA — not real results)' : ''}`);
  if (!PASSWORD) console.log('  ! DASHBOARD_PASSWORD not set: anyone who can reach this port can view it.');
});
