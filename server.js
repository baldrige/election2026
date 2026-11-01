'use strict';
// Election night dashboard server. Zero dependencies; Node 18+.
//   node server.js            -> live mode (needs AP_API_KEY for vote tallies)
//   DEMO=1 node server.js     -> synthetic data, for testing the UI
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ApProvider } = require('./lib/results');
const markets = require('./lib/markets');
const news = require('./lib/news');
const demo = require('./lib/demo');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DEMO = process.env.DEMO === '1' || cfg.results.provider === 'demo';
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
  results: { races: [], provider: null, updated: null, error: null },
  calls: [],                // race-call log, newest first
  markets: { markets: [], errors: [], updated: null, history: {} },
  news: { items: [], errors: [], updated: null },
};

// ---------- results ----------
const provider = DEMO ? new demo.DemoProvider() : new ApProvider(cfg);
const calledSeen = new Map();
async function pollResults() {
  try {
    const races = await provider.fetch();
    for (const r of races) {
      if (r.winnerParty && calledSeen.get(r.id) !== r.winnerParty) {
        const first = !calledSeen.has(r.id);
        calledSeen.set(r.id, r.winnerParty);
        if (state.results.updated || DEMO) {  // don't flood the log with calls that existed at startup
          const w = r.candidates.find((c) => c.winner);
          state.calls.unshift({ ts: Date.now(), id: r.id, title: r.title, office: r.office,
            winner: w ? w.name : '', party: r.winnerParty, changed: !first });
        }
      }
    }
    state.calls = state.calls.slice(0, 200);
    Object.assign(state.results, { races, provider: provider.name, updated: Date.now(), error: null });
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
    for (const m of list) {
      const top = m.outcomes[0];
      if (!top) continue;
      const h = (state.markets.history[m.key] ||= []);
      // Track the probability of a stable label (first one we saw) so the sparkline doesn't flip.
      const label = h.label || (h.label = top.label);
      const o = m.outcomes.find((x) => x.label === label);
      if (o) h.push([now, o.prob]);
      if (h.length > 720) h.splice(0, h.length - 720);
    }
    Object.assign(state.markets, { markets: list, errors, updated: now });
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
        watchStates: cfg.results.watchStates,
      },
      results: state.results,
      calls: state.calls,
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
  if (!DEMO && !process.env.AP_API_KEY) console.log('  ! AP_API_KEY not set: vote tallies disabled; markets and news still work.');
});
