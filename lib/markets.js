'use strict';
// Prediction markets: Kalshi, Polymarket, PredictIt — all public, unauthenticated read endpoints.
// Normalised market shape: { key, source, title, url, outcomes:[{label, prob}], volume }
const { get } = require('./http');
const { Guard } = require('./guard');

const num = (v) => (v == null || v === '' ? null : Number(v));

function kalshiPrice(m) {
  // Newer API returns *_dollars strings (0-1); older returns integer cents.
  const d = num(m.last_price_dollars) ?? (num(m.last_price) != null ? num(m.last_price) / 100 : null);
  const bid = num(m.yes_bid_dollars) ?? (num(m.yes_bid) != null ? num(m.yes_bid) / 100 : null);
  const ask = num(m.yes_ask_dollars) ?? (num(m.yes_ask) != null ? num(m.yes_ask) / 100 : null);
  if (bid != null && ask != null && ask > 0) return (bid + ask) / 2; // midpoint is less noisy than last trade
  return d;
}

async function kalshi(cfg) {
  const { baseUrl, seriesTickers = [], eventTickers = [] } = cfg;
  const events = [];
  for (const s of seriesTickers) {
    const d = await get(`${baseUrl}/events?series_ticker=${encodeURIComponent(s)}&status=open&with_nested_markets=true&limit=50`);
    if (!(d.events || []).length) throw new Error(`Kalshi series ${s}: no open events (check ticker)`);
    events.push(...d.events);
  }
  for (const t of eventTickers) {
    const d = await get(`${baseUrl}/events/${encodeURIComponent(t)}?with_nested_markets=true`);
    if (d.event) events.push({ ...d.event, markets: d.markets || d.event.markets });
  }
  return events.map((e) => ({
    key: `kalshi:${e.event_ticker}`,
    source: 'Kalshi',
    title: e.title,
    url: `https://kalshi.com/markets/${String(e.series_ticker || e.event_ticker).toLowerCase()}`,
    outcomes: (e.markets || [])
      .map((m) => ({ label: m.yes_sub_title || m.subtitle || m.title, prob: kalshiPrice(m) }))
      .filter((o) => o.prob != null)
      .sort((a, b) => b.prob - a.prob),
    volume: (e.markets || []).reduce((s, m) => s + (num(m.volume) || 0), 0),
  }));
}

const parseJsonArr = (s) => { try { return Array.isArray(s) ? s : JSON.parse(s || '[]'); } catch { return []; } };

async function polymarket(cfg) {
  const out = [];
  for (const slug of cfg.eventSlugs || []) {
    const arr = await get(`${cfg.baseUrl}/events?slug=${encodeURIComponent(slug)}`);
    const e = Array.isArray(arr) ? arr[0] : null;
    if (!e) throw new Error(`Polymarket slug "${slug}" not found`);
    const markets = (e.markets || []).filter((m) => !m.closed || e.closed);
    let outcomes;
    if (markets.length === 1) {
      const m = markets[0];
      const labels = parseJsonArr(m.outcomes), prices = parseJsonArr(m.outcomePrices);
      outcomes = labels.map((l, i) => ({ label: l, prob: num(prices[i]) }));
    } else {
      // Multi-outcome event: each market is a Yes/No on one outcome; use its "Yes" price.
      outcomes = markets.map((m) => ({
        label: m.groupItemTitle || m.question,
        prob: num(parseJsonArr(m.outcomePrices)[0]),
      }));
    }
    out.push({
      key: `polymarket:${slug}`,
      source: 'Polymarket',
      title: e.title,
      url: `https://polymarket.com/event/${slug}`,
      outcomes: outcomes.filter((o) => o.prob != null).sort((a, b) => b.prob - a.prob),
      volume: num(e.volume),
    });
  }
  return out;
}

async function predictit(cfg) {
  const out = [];
  for (const id of cfg.marketIds || []) {
    const m = await get(`${cfg.baseUrl}/markets/${id}`);
    out.push({
      key: `predictit:${id}`,
      source: 'PredictIt',
      title: m.name,
      url: m.url,
      outcomes: (m.contracts || [])
        .map((c) => ({ label: c.shortName || c.name, prob: num(c.lastTradePrice) }))
        .filter((o) => o.prob != null)
        .sort((a, b) => b.prob - a.prob),
      volume: null,
    });
  }
  return out;
}

// Runs every provider independently so one broken source doesn't blank the panel.
// A failing provider keeps showing its last good prices (marked stale) while it backs off.
const guard = new Guard();
async function fetchAll(mcfg) {
  const jobs = { Kalshi: () => kalshi(mcfg.kalshi), Polymarket: () => polymarket(mcfg.polymarket), PredictIt: () => predictit(mcfg.predictit) };
  const markets = [], errors = [];
  await Promise.all(Object.entries(jobs).map(async ([name, fn]) => {
    const r = await guard.run(name, fn);
    if (r.error) errors.push(r.error);
    for (const m of r.data || []) markets.push(r.stale ? { ...m, stale: true, asOf: r.asOf } : m);
  }));
  return { markets, errors };
}

// ---------- grouping: one widget per question across platforms ----------
const STATE_NAMES = /alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district|\b[A-Z]{2}-\d/i;

// Map an outcome label onto a party, if it is one ("Democrats", "Democratic Party", "GOP", "R" ...).
function partyOf(label = '') {
  const s = String(label).trim();
  // Whole-label match only, so combos like "D House, R Senate" are not mistaken for a party.
  if (/^(d|dem|dems|democrat|democrats|democratic)( party)?$/i.test(s)) return 'Dem';
  if (/^(r|rep|reps|republican|republicans|gop)( party)?$/i.test(s)) return 'GOP';
  return null;
}

// Dem/GOP probabilities of a two-party market (renormalised over the two parties), or null.
function partySplit(m) {
  let dem = null, gop = null;
  for (const o of m.outcomes) {
    const p = partyOf(o.label);
    if (p === 'Dem' && dem == null) dem = o.prob;
    if (p === 'GOP' && gop == null) gop = o.prob;
  }
  if (dem == null && gop == null) return null;
  if (dem == null) dem = 1 - gop;
  if (gop == null) gop = 1 - dem;
  const sum = dem + gop;
  return sum > 0 ? { dem: dem / sum, gop: gop / sum } : null;
}

// groupsCfg: [{ key, label, match }]. A market joins a group if its title matches, it isn't about a
// single state/district, and its outcomes are the two parties. Everything else stays a single card.
function groupMarkets(list, groupsCfg = []) {
  const groups = groupsCfg.map((g) => ({ key: g.key, label: g.label, re: new RegExp(g.match, 'i'), rows: [] }));
  const others = [];
  for (const m of list) {
    const split = partySplit(m);
    const g = split && !STATE_NAMES.test(m.title) && groups.find((x) => x.re.test(m.title));
    if (g) g.rows.push({ key: m.key, source: m.source, title: m.title, url: m.url, volume: m.volume, stale: !!m.stale, asOf: m.asOf || null, ...split });
    else others.push(m);
  }
  const order = { Kalshi: 0, Polymarket: 1, PredictIt: 2 };
  const out = groups.filter((g) => g.rows.length).map((g) => {
    g.rows.sort((a, b) => (order[a.source] ?? 9) - (order[b.source] ?? 9));
    const dem = g.rows.reduce((s, r) => s + r.dem, 0) / g.rows.length;
    return { key: g.key, label: g.label, dem, gop: 1 - dem, rows: g.rows };
  });
  return { groups: out, others };
}

module.exports = { fetchAll, kalshi, polymarket, predictit, groupMarkets, partyOf, partySplit };
