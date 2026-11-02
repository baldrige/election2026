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
      if (!adapter) { this.status[st] = { ok: false, message: 'No adapter for this state', url }; return; }
      if (adapter.noLiveFeed) { this.status[st] = { ok: false, info: true, message: adapter.noLiveFeed, url: adapter.homepage }; return; }
      const tpl = entry.url || adapter.defaultUrl;
      const url = tpl ? fillUrl(tpl, entry, this.cfg.electionDate) : null;
      const minMs = 1000 * (entry.minIntervalSec || adapter.minIntervalSec || 30);
      if (this.lastFetch[st] && Date.now() - this.lastFetch[st] < minMs) return;
      this.lastFetch[st] = Date.now();
      try {
        const races = await adapter.fetch({ url, entry, electionDate: this.cfg.electionDate, state: st });
        if (!races.length) throw new Error('Feed loaded but no U.S. Senate contest was found in it');
        for (const r of races) Object.assign(r, { source: adapter.sourceName, sourceUrl: adapter.homepage || url });
        this.last[st] = races;
        this.status[st] = { ok: true, message: `${races.length} race(s), ${races[0].candidates.length} candidates`, updated: Date.now(), url };
      } catch (e) {
        this.status[st] = { ok: false, message: e.message, updated: this.status[st]?.updated, url, stale: !!this.last[st] };
      }
    }));
    return Object.values(this.last).flat();
  }
  feedStatus() {
    return Object.entries(this.status).map(([state, s]) => ({ state, ...s })).sort((a, b) => a.state.localeCompare(b.state));
  }
}

module.exports = { StateFeedsProvider };
