'use strict';
// Per-source failure handling: keep the last good data, back off after errors
// (longer for rate limits, honoring Retry-After), and describe the situation in one line.
const MIN = 60 * 1000;
const fmt = (ts) => new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
const human = (ms) => (ms >= MIN ? `${Math.round(ms / MIN)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

class Guard {
  constructor() { this.s = new Map(); }
  // fn() fetches fresh data. Returns { data, error, stale, asOf }.
  async run(key, fn, now = Date.now()) {
    const st = this.s.get(key) || { data: null, asOf: null, fails: 0, until: 0, why: '' };
    this.s.set(key, st);
    if (now < st.until) return this.result(key, st, now);
    try {
      st.data = await fn(); st.asOf = now; st.fails = 0; st.until = 0; st.why = '';
      return { data: st.data, error: null, stale: false, asOf: now };
    } catch (e) {
      st.fails++;
      const limited = e.status === 429 || e.status === 503;
      const base = limited ? 2 * MIN : 30 * 1000;
      let wait = Math.min(base * 2 ** (st.fails - 1), limited ? 15 * MIN : 10 * MIN);
      if (e.retryAfter != null) wait = Math.max(wait, e.retryAfter * 1000);
      st.until = now + wait;
      st.why = limited ? `rate-limited (HTTP ${e.status})` : e.message;
      return this.result(key, st, now);
    }
  }
  result(key, st, now) {
    const retry = `retrying in ${human(st.until - now)}`;
    const shown = st.data ? `showing data from ${fmt(st.asOf)}` : 'no data yet';
    return { data: st.data, error: `${key}: ${st.why}; ${retry}; ${shown}`, stale: !!st.data, asOf: st.asOf };
  }
}

module.exports = { Guard };
