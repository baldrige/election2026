'use strict';
// Small fetch wrapper: timeout, UA, readable errors. Node 18+ (global fetch).
const UA = 'ElectionNightDashboard/1.0 (personal, non-commercial)';

class HttpError extends Error {
  constructor(message, { status, retryAfter } = {}) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// Turn an error body (often a whole HTML page) into a short readable snippet.
function summarize(body) {
  const title = body.match(/<title>([^<]*)<\/title>/i);
  const text = (title ? title[1] : body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.slice(0, 117) + '…' : text;
}

function parseRetryAfter(v) {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : null;
}

async function get(url, { headers = {}, timeoutMs = 15000, as = 'json' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const host = new URL(url).host;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = summarize(await res.text().catch(() => ''));
      throw new HttpError(`HTTP ${res.status} from ${host}${body ? ` (${body})` : ''}`,
        { status: res.status, retryAfter: parseRetryAfter(res.headers && res.headers.get && res.headers.get('retry-after')) });
    }
    return as === 'json' ? res.json() : res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(`Timed out fetching ${host}`, { status: 0 });
    // Node's fetch reports network problems as just "fetch failed"; add the underlying reason.
    if (e.message === 'fetch failed' && e.cause) {
      const c = e.cause;
      e.message = `fetch failed: ${c.code || ''}${c.code && c.message ? ' – ' : ''}${c.message || ''} (${host})`.replace(/\s+/g, ' ');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { get, HttpError, summarize };
