'use strict';
// Free results from official state election websites, for the Senate watch-list states.
// These give vote COUNTS only — states don't "call" races. One adapter per state in lib/states/.
const path = require('path');
const fs = require('fs');
const { fillUrl } = require('./states/helpers');

function loadAdapters() {
  const dir = path.join(__dirname, 'states');
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (/^[a-z]{2}\.js$/.test(f)) out[f.slice(0, 2).toUpperCase()] = require(path.join(dir, f));
  }
  return out;
}

class StateFeedsProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.adapters = loadAdapters();
    this.status = {}; // ST -> {ok, message, updated, url, races}
    this.last = {};   // ST -> races (kept if a later fetch fails)
    this.lastFetch = {}; // ST -> ms, to respect each state's minimum polling interval
  }
  entries() {
    return Object.entries(this.cfg.results.stateFeeds || {}).filter(([, e]) => e && e.enabled !== false && !String(e.url || '').startsWith('_'));
  }
  async fetch() {
    await Promise.all(this.entries().map(async ([st, entry]) => {
      const adapter = this.adapters[st];
      if (!adapter) { this.status[st] = { ok: false, message: 'No adapter for this state' }; return; }
      if (adapter.noLiveFeed) { this.status[st] = { ok: false, info: true, message: adapter.noLiveFeed, url: adapter.homepage }; return; }
      // entry.urls: candidate addresses tried in order (used when a state may move its file on the night);
      // the one that last worked is tried first.
      const tpls = Array.isArray(entry.urls) && entry.urls.length ? entry.urls : [entry.url || adapter.defaultUrl].filter(Boolean);
      let urls = tpls.map((t) => fillUrl(t, entry, this.cfg.electionDate));
      if (this.goodUrl && this.goodUrl[st] && urls.includes(this.goodUrl[st])) urls = [this.goodUrl[st], ...urls.filter((u) => u !== this.goodUrl[st])];
      const minMs = 1000 * (entry.minIntervalSec || adapter.minIntervalSec || 30);
      if (this.lastFetch[st] && Date.now() - this.lastFetch[st] < minMs) return;
      this.lastFetch[st] = Date.now();
      const tried = [];
      for (const url of urls.length ? urls : [null]) {
        try {
          const races = await adapter.fetch({ url, entry, electionDate: this.cfg.electionDate, state: st });
          if (!races.length) throw new Error('Feed loaded but no U.S. Senate contest was found in it');
          for (const r of races) Object.assign(r, { source: adapter.sourceName, sourceUrl: adapter.homepage || url });
          this.last[st] = races;
          (this.goodUrl ||= {})[st] = url;
          this.status[st] = { ok: true, message: `${races.length} race(s), ${races[0].candidates.length} candidates`, updated: Date.now(), url };
          return;
        } catch (e) {
          // Back off harder when a state rate-limits us.
          if (e.status === 429 || e.status === 503) this.lastFetch[st] = Date.now() + Math.max(120, e.retryAfter || 0) * 1000 - minMs;
          tried.push({ url, msg: e.message, status: e.status });
          if (e.status === 429) break; // don't hammer other URLs on the same host
        }
      }
      const last = tried[tried.length - 1] || { msg: 'no URL configured' };
      const msg = tried.length > 1 ? `${last.msg} (tried ${tried.length} addresses: ${tried.map((t) => `${t.status || `[${String(t.msg).slice(0, 70)}]`} ${t.url}`).join('; ')})` : last.msg;
      this.status[st] = { ok: false, message: msg, updated: this.status[st]?.updated, url: last.url, stale: !!this.last[st] };
    }));
    return Object.values(this.last).flat();
  }
  feedStatus() {
    return Object.entries(this.status).map(([state, s]) => ({ state, ...s })).sort((a, b) => a.state.localeCompare(b.state));
  }
}

module.exports = { StateFeedsProvider };
