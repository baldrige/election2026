'use strict';
// Prediction markets: Kalshi, Polymarket, PredictIt — all public, unauthenticated read endpoints.
// Normalised market shape: { key, source, title, url, outcomes:[{label, prob}], volume }
const { get } = require('./http');

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
async function fetchAll(mcfg) {
  const jobs = { Kalshi: () => kalshi(mcfg.kalshi), Polymarket: () => polymarket(mcfg.polymarket), PredictIt: () => predictit(mcfg.predictit) };
  const markets = [], errors = [];
  await Promise.all(Object.entries(jobs).map(async ([name, fn]) => {
    try { markets.push(...(await fn())); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }));
  return { markets, errors };
}

module.exports = { fetchAll, kalshi, polymarket, predictit };
