'use strict';
// Prediction-market odds for individual races (Senate, Governor, House), shown on each race card.
//  - Polymarket: page through the "midterms" tag every few minutes; event titles like
//    "Texas Senate Election Winner" / "California House Election Winner District 22" map to races.
//  - Kalshi: race events have predictable tickers (SENATETX-26, GOVPARTYTX-26, HOUSECA22-26, HOUSEAKAL-26).
//    Fetched 10 per request via /markets?event_ticker=A,B,...; if the API won't batch, falls back to one
//    event per request for Senate and Governor only. All Kalshi calls share one throttle (lib/kalshi.js).
const { get } = require('./http');
const { kget, gate } = require('./kalshi');
const { NAMES } = require('./civicapi');
const { kalshiPrice } = require('./markets');

const STATE_BY_NAME = Object.entries(NAMES).sort((a, b) => b[1].length - a[1].length).map(([c, n]) => [n.toLowerCase(), c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PARTY_LETTER = { D: 'Dem', R: 'GOP', I: 'Ind', L: 'Lib', G: 'Grn' };

// ---------- keys ----------
// Race key used everywhere here: "S:TX", "G:TX", "H:CA-22", "H:AK-AL".
function raceKey(r) { return r.office === 'H' ? `H:${r.district}` : `${r.office}:${r.state}`; }

function kalshiTicker(key, yy = '26', govOverrides = {}) {
  const [office, rest] = key.split(':');
  if (office === 'S') return `SENATE${rest}-${yy}`;
  if (office === 'G') return `${govOverrides[rest] || `GOVPARTY${rest}`}-${yy}`;
  const m = /^([A-Z]{2})-(\d+|AL)$/.exec(rest);
  if (!m) return null;
  return `HOUSE${m[1]}${m[2] === 'AL' ? 'AL' : Number(m[2])}-${yy}`;
}

function kalshiKey(eventTicker = '') {
  const base = eventTicker.replace(/-\d{2}$/, '');
  let m;
  if ((m = /^SENATE([A-Z]{2})$/.exec(base))) return `S:${m[1]}`;
  if ((m = /^(?:GOVPARTY|KXGOV)([A-Z]{2})$/.exec(base))) return `G:${m[1]}`;
  if ((m = /^HOUSE([A-Z]{2})(AL|\d{1,2})$/.exec(base))) return `H:${m[1]}-${m[2] === 'AL' ? 'AL' : m[2].padStart(2, '0')}`;
  return null;
}

function polymarketKey(title = '') {
  const low = title.toLowerCase().trim();
  for (const [name, code] of STATE_BY_NAME) {
    if (!low.startsWith(name + ' ')) continue;
    const tail = low.slice(name.length + 1).trim();
    if (/^senate (special )?election winner$/.test(tail)) return `S:${code}`;
    if (/^governor election winner$/.test(tail)) return `G:${code}`;
    let m = /^house election winner district (\d{1,2})$/.exec(tail) || /^(\d{1,2})(?:st|nd|rd|th)? congressional district election winner$/.exec(tail);
    if (m) return `H:${code}-${m[1].padStart(2, '0')}`;
    if (/^(at-large )?house election winner( at-large)?$/.test(tail) || /^at-large congressional district election winner$/.test(tail)) return `H:${code}-AL`;
  }
  return null;
}

// ---------- outcome parsing ----------
function kalshiOutcomes(markets) {
  return markets.map((m) => {
    const suffix = String(m.ticker || '').split('-').pop().toUpperCase();
    const party = PARTY_LETTER[suffix] || null;
    const name = String(m.yes_sub_title || '').trim();
    const isName = name && !/party|^(yes|no|democrat|republican)/i.test(name);
    return { party, name: isName ? name : null, prob: kalshiPrice(m) };
  }).filter((o) => o.prob != null && (o.party || o.name));
}

function polymarketOutcomes(event) {
  const out = [];
  for (const m of event.markets || []) {
    if (m.closed === true) continue;
    let prices; try { prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices; } catch { prices = null; }
    const prob = prices && prices[0] != null ? Number(prices[0]) : null;
    if (prob == null || !Number.isFinite(prob)) continue;
    const title = String(m.groupItemTitle || '').trim();
    const pm = /\(([A-Za-z])\)\s*$/.exec(title);
    let party = pm ? PARTY_LETTER[pm[1].toUpperCase()] || null : null;
    let name = title.replace(/\s*\([A-Za-z]\)\s*$/, '').trim();
    if (/^(democratic|democrats?)( party)?$/i.test(name)) { party = 'Dem'; name = null; }
    else if (/^(republican|republicans|gop)( party)?$/i.test(name)) { party = 'GOP'; name = null; }
    if (!party && !name) continue;
    out.push({ party, name: name || null, prob });
  }
  return out;
}

// ---------- party assignment for name-only outcomes ----------
// Markets sometimes list candidates without a party (California's top-two, some Polymarket events).
// Match the name to the race's candidate list (from civicAPI / state feeds), which has parties.
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
function nameTokens(n = '') {
  return String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/["“”'‘’]([^"“”'‘’]*)["“”'‘’]/g, ' ') // drop quoted nicknames: Bradford "Brad" Hall
    .replace(/\([^)]*\)/g, ' ')                 // drop "(D)", "(Inc.)"
    .toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((t) => t && !SUFFIX.has(t));
}
const normName = (n) => nameTokens(n).join(' ');

// candidates: [{name, party}] for the race; overrides: {"Full Name": "Dem"|"GOP"|...}
function partyForName(name, candidates = [], overrides = {}) {
  if (!name) return null;
  const want = normName(name);
  for (const [k, v] of Object.entries(overrides)) if (normName(k) === want) return v;
  const t = nameTokens(name);
  if (!t.length) return null;
  const last = t[t.length - 1], first = t[0];
  const cands = candidates.filter((c) => c && c.name && c.party).map((c) => ({ party: c.party, t: nameTokens(c.name) })).filter((c) => c.t.length);
  const exact = cands.filter((c) => c.t.join(' ') === want);
  if (exact.length === 1) return exact[0].party;
  const byInitial = cands.filter((c) => c.t[c.t.length - 1] === last && c.t[0][0] === first[0]);
  if (byInitial.length === 1) return byInitial[0].party;
  const byLast = cands.filter((c) => c.t[c.t.length - 1] === last || c.t.includes(last));
  if (byLast.length === 1) return byLast[0].party;
  return null;
}

// ---------- provider ----------
class RaceOddsProvider {
  constructor(cfg) {
    this.c = cfg.markets.raceMarkets || {};
    this.cfgAll = cfg;
    this.odds = new Map(); // key -> { Kalshi: {outcomes,url,asOf}, Polymarket: {...} }
    // Senate/Governor races come from the configured 2026 lists, so odds load even before results do;
    // House districts follow the results we actually have.
    const ca = cfg.civicapi || {};
    this.baseKeys = [...(ca.senateStates || []).map((st) => `S:${st}`), ...(ca.governorStates || []).map((st) => `G:${st}`)];
    this.raceKeys = [...this.baseKeys];
    this.status = { Kalshi: 'starting', Polymarket: 'starting' };
    this.batch = this.c.kalshiBatch !== false; // flips to false if Kalshi won't batch
    gate.setGap(this.c.kalshiMinGapMs || 2000);
  }
  setRaces(races) {
    this.raceKeys = [...new Set([...this.baseKeys, ...races.map(raceKey)])];
    this.cands = new Map(races.map((r) => [raceKey(r), r.candidates || []])); // for party matching
  }
  forKey(key) {
    const [office, rest] = key.split(':');
    return this.forRace(office === 'H' ? { office, district: rest } : { office, state: rest });
  }

  put(key, source, outcomes, url) {
    if (!outcomes.length) return;
    const o = this.odds.get(key) || {};
    o[source] = { outcomes: outcomes.sort((a, b) => b.prob - a.prob), url, asOf: Date.now() };
    this.odds.set(key, o);
  }

  // --- Polymarket ---
  async polymarketSweep() {
    const base = (this.cfgAll.markets.polymarket || {}).baseUrl || 'https://gamma-api.polymarket.com';
    const tag = this.c.polymarketTag || 'midterms';
    let found = 0;
    for (let offset = 0; offset <= 1000; offset += 100) {
      let events;
      try { events = await get(`${base}/events?closed=false&limit=100&offset=${offset}&tag_slug=${encodeURIComponent(tag)}`); }
      catch (e) { if (e.status === 422 && offset) break; throw e; }
      if (!Array.isArray(events) || !events.length) break;
      for (const ev of events) {
        const key = polymarketKey(ev.title);
        if (!key) continue;
        this.put(key, 'Polymarket', polymarketOutcomes(ev), `https://polymarket.com/event/${ev.slug}`);
        found++;
      }
      await sleep(1000);
    }
    this.status.Polymarket = `${found} race markets`;
  }

  // --- Kalshi ---
  wantedTickers() {
    const houseMode = this.c.kalshiHouse || 'all'; // all | none
    const keys = this.raceKeys.filter((k) => !k.startsWith('H:') || (houseMode === 'all' && this.batch));
    // Senate/Governor first so they refresh even if the House pass is cut short.
    keys.sort((a, b) => (a[0] === 'H') - (b[0] === 'H'));
    return keys.map((k) => kalshiTicker(k, this.c.kalshiYear || '26', this.c.kalshiGovOverrides || {})).filter(Boolean);
  }
  absorbKalshiMarkets(markets) {
    const byEvent = new Map();
    for (const m of markets) {
      // Some markets omit event_ticker (seen on HOUSEAKAL-26); derive it from the market ticker.
      const ev = m.event_ticker || String(m.ticker || '').replace(/-[^-]+$/, '');
      (byEvent.get(ev) || byEvent.set(ev, []).get(ev)).push(m);
    }
    for (const [ev, ms] of byEvent) {
      const key = kalshiKey(ev);
      if (key) this.put(key, 'Kalshi', kalshiOutcomes(ms), `https://kalshi.com/markets/${ev.replace(/-\d{2}$/, '').toLowerCase()}`);
    }
    return byEvent;
  }
  async kalshiPass() {
    const base = (this.cfgAll.markets.kalshi || {}).baseUrl || 'https://api.elections.kalshi.com/trade-api/v2';
    const tickers = this.wantedTickers();
    let got = 0;
    if (this.batch) {
      for (let i = 0; i < tickers.length; i += 10) {
        const chunk = tickers.slice(i, i + 10);
        let res;
        try { res = await kget(`${base}/markets?event_ticker=${chunk.join(',')}&limit=1000`); }
        catch (e) { if (e.status === 400 && i === 0) { this.batch = false; return this.kalshiPass(); } throw e; }
        const seen = this.absorbKalshiMarkets(res.markets || []);
        got += seen.size;
        // Batching check: if only one event came back, ask for another one alone. If that one has
        // markets, the API ignored the list and we switch to one event per request.
        if (i === 0 && seen.size <= 1 && chunk.length > 1) {
          const probe = chunk.find((t) => !seen.has(t));
          const one = await kget(`${base}/markets?event_ticker=${probe}&limit=100`).catch(() => ({ markets: [] }));
          if ((one.markets || []).length) { this.batch = false; return this.kalshiPass(); }
        }
      }
    } else {
      for (const t of tickers) {
        try {
          const res = await kget(`${base}/events/${t}?with_nested_markets=true`);
          const ms = (res.markets || (res.event || {}).markets || []).map((m) => ({ ...m, event_ticker: m.event_ticker || t }));
          if (this.absorbKalshiMarkets(ms).size) got++;
        } catch (e) { if (e.status !== 404) throw e; }
      }
    }
    this.status.Kalshi = `${got} race markets${this.batch ? '' : ' (one per request; House skipped)'}`;
  }

  start() {
    const loop = (name, fn, everyMs) => {
      const run = async () => {
        const t0 = Date.now();
        try { await fn(); } catch (e) { this.status[name] = `error: ${e.message}${name === 'Kalshi' && gate.paused() ? ` (paused ${gate.paused()} s)` : ''}`; }
        setTimeout(run, Math.max(15000, everyMs - (Date.now() - t0)));
      };
      setTimeout(run, 5000); // let the first results load so House districts are known
    };
    if (this.c.polymarket !== false) loop('Polymarket', () => this.polymarketSweep(), 1000 * (this.c.polymarketEverySeconds || 180));
    if (this.c.kalshi !== false) loop('Kalshi', () => this.kalshiPass(), 1000 * (this.c.kalshiEverySeconds || 240));
  }

  // Compact odds for a race, for the API: { Kalshi: {o:[{p,n,v}], url, asOf}, ... }
  forRace(r) {
    const key = raceKey(r);
    const o = this.odds.get(key);
    if (!o) return null;
    const cands = (r.candidates && r.candidates.length ? r.candidates : (this.cands && this.cands.get(key))) || [];
    const overrides = this.c.candidateParties || {};
    const out = {};
    for (const [src, d] of Object.entries(o)) {
      out[src] = { url: d.url, asOf: d.asOf, o: d.outcomes.slice(0, 3).map((x) => {
        const p = x.party || partyForName(x.name, cands, overrides);
        return { p, n: x.name, v: Math.round(x.prob * 1000) / 1000, ...(p && !x.party ? { matched: true } : {}) };
      }) };
    }
    return out;
  }
}

module.exports = { partyForName, normName, nameTokens, RaceOddsProvider, raceKey, kalshiTicker, kalshiKey, polymarketKey, kalshiOutcomes, polymarketOutcomes };
