'use strict';
// Small fetch wrapper: timeout, UA, useful errors. Node 18+ (global fetch).
const UA = 'ElectionNightDashboard/1.0 (personal, non-commercial)';

async function get(url, { headers = {}, timeoutMs = 15000, as = 'json' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}${body ? `: ${body}` : ''}`);
    }
    return as === 'json' ? res.json() : res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timed out fetching ${new URL(url).host}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { get };
