'use strict';
// Shared helpers for official state results feeds.
const { get } = require('../http');

const UA_HEADERS = { 'Cache-Control': 'no-cache' };

async function fetchText(url, opts = {}) { return get(url, { as: 'text', headers: { ...UA_HEADERS, ...(opts.headers || {}) }, timeoutMs: 30000 }); }
async function fetchJson(url, opts = {}) { return get(url, { headers: { ...UA_HEADERS, ...(opts.headers || {}) }, timeoutMs: 30000 }); }
async function fetchBuffer(url, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ElectionNightDashboard/1.0', ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

// Split a delimited text file into rows of objects. Handles quoted CSV fields.
function parseDelimited(text, delim = '\t', { header = true, columns = null } = {}) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const cols = columns || (header ? rows.shift().map((h) => h.trim()) : null);
  if (!cols) return rows;
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

const toNum = (v) => { const n = Number(String(v ?? '').replace(/[,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// Map the many ways states spell party names onto the dashboard's codes.
function normParty(p = '') {
  const s = String(p).trim().toUpperCase();
  if (!s) return 'Oth';
  if (/^(DEM|D|DFL|DEMOCRAT|DEMOCRATIC)/.test(s)) return 'Dem';
  if (/^(REP|R|GOP|REPUBLICAN)/.test(s)) return 'GOP';
  if (/^(LIB|L|LBT|LPF|LPN)/.test(s) || /LIBERTARIAN/.test(s)) return 'Lib';
  if (/^(GRN|GRE|G\b)/.test(s) || /GREEN/.test(s)) return 'Grn';
  if (/^(IND|I\b|NPA|NON|NOP|UNA|NP\b)/.test(s) || /INDEPENDENT|NO PARTY|NONPARTISAN|UNAFFILIATED/.test(s)) return 'Ind';
  return 'Oth';
}

const isWriteIn = (name = '') => /write[\s-]?in|^over ?votes?$|^under ?votes?$|^blank/i.test(name.trim());

// Build a dashboard race from {name, party, votes} candidates (merging duplicates).
function makeRace({ state, special = false, candidates, reporting = null, reportingLabel = null, source, sourceUrl, updated = null }) {
  const merged = new Map();
  for (const c of candidates) {
    if (!c.name || isWriteIn(c.name)) continue;
    const k = c.name.trim().toUpperCase();
    const m = merged.get(k) || { name: c.name.trim(), party: c.party, votes: 0 };
    m.votes += toNum(c.votes);
    merged.set(k, m);
  }
  const list = [...merged.values()];
  const total = list.reduce((s, c) => s + c.votes, 0);
  list.forEach((c) => { c.pct = total ? (100 * c.votes) / total : 0; c.winner = false; });
  list.sort((a, b) => b.votes - a.votes);
  return {
    id: `state:${state}:S${special ? ':special' : ''}`,
    state, office: 'S', district: null, special,
    title: `${state} · U.S. Senate${special ? ' (special)' : ''}`,
    eevp: reporting, reportingLabel,
    lastUpdated: updated || new Date().toISOString(),
    candidates: list, winnerParty: null, runoff: false,
    source, sourceUrl, countsOnly: true,
  };
}

// Template a URL: {date} -> 20261103, {dateDash} -> 2026-11-03, plus any {key} from the entry.
function fillUrl(tpl, entry, electionDate) {
  const vars = { date: electionDate.replace(/-/g, ''), dateDash: electionDate, ...entry };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

const isSenate = (s = '') => /(U\.?\s?S\.?|UNITED STATES)\s*SENAT/i.test(s);
const isSpecial = (s = '') => /special|unexpired|vacancy/i.test(s);

module.exports = { fetchText, fetchJson, fetchBuffer, parseDelimited, toNum, normParty, isWriteIn, makeRace, fillUrl, isSenate, isSpecial };
