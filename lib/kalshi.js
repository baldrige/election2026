'use strict';
// One shared gate for every Kalshi request. Requests go out one at a time with a minimum gap;
// high-priority requests (the chamber-control widgets) jump ahead of the race-odds sweep.
// After a 429, ALL Kalshi requests fail fast (no waiting) until the pause ends: Retry-After or 2 min.
const { get, HttpError } = require('./http');

class Gate {
  constructor(minGapMs = 2000) { this.gap = minGapMs; this.last = 0; this.pausedUntil = 0; this.queues = { high: [], low: [] }; this.busy = false; }
  setGap(ms) { if (ms > 0) this.gap = ms; }
  paused() { return Date.now() < this.pausedUntil ? Math.ceil((this.pausedUntil - Date.now()) / 1000) : 0; }
  pausedError() { return new HttpError(`Kalshi paused after a rate limit (${this.paused()} s left)`, { status: 429, retryAfter: this.paused() }); }
  run(fn, { priority = 'low' } = {}) {
    if (this.paused()) return Promise.reject(this.pausedError());
    return new Promise((resolve, reject) => { this.queues[priority].push({ fn, resolve, reject }); this.pump(); });
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const job = this.queues.high.shift() || this.queues.low.shift();
        if (!job) break;
        if (this.paused()) { job.reject(this.pausedError()); continue; }
        const wait = this.last + this.gap - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.last = Date.now();
        try { job.resolve(await job.fn()); } catch (e) {
          if (e.status === 429 || e.status === 503) this.pausedUntil = Date.now() + 1000 * Math.max(120, e.retryAfter || 0);
          job.reject(e);
        }
      }
    } finally { this.busy = false; }
  }
}

const gate = new Gate();
const kget = (url, opts = {}) => gate.run(() => get(url, opts), { priority: opts.priority || 'low' });
module.exports = { gate, kget, Gate };
