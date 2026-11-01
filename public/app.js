'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PARTY_VAR = { Dem: 'var(--dem)', GOP: 'var(--gop)' };
const partyColor = (p) => PARTY_VAR[p] || 'var(--oth)';
const partyLabel = (p) => ({ Dem: 'D', GOP: 'R' }[p] || p || '?');
const fmtNum = (n) => (n ?? 0).toLocaleString('en-US');
const ET = { timeZone: 'America/New_York' };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { ...ET, hour: 'numeric', minute: '2-digit' });
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-US', { ...ET, month: 'short', day: 'numeric' });
}

const ui = { office: 'S', view: 'watch', q: '' };
let S = null; // last server state

// ---------- balance of power ----------
function tally(races, office) {
  const t = { Dem: 0, GOP: 0, Oth: 0, open: 0, total: 0 };
  for (const r of races) {
    if (r.office !== office) continue;
    t.total++;
    if (!r.winnerParty) t.open++;
    else if (r.winnerParty === 'Dem' || r.winnerParty === 'GOP') t[r.winnerParty]++;
    else t.Oth++;
  }
  return t;
}
function bopCard(title, d, g, o, open, total, need, foot) {
  const pct = (n) => (100 * n) / total;
  const seg = (n, color, label) => n ? `<span style="width:${pct(n)}%;background:${color}" title="${label}: ${n}"></span>` : '';
  return `<div class="bop-card">
    <h3>${title}</h3>
    <div class="bop-nums">
      <span class="d"><span class="sw" style="background:var(--dem)"></span><span class="lab">Dem</span> <b>${d}</b></span>
      <span class="lab">${open} uncalled${o ? ` · ${o} other` : ''}</span>
      <span class="d"><b>${g}</b> <span class="lab">GOP</span><span class="sw" style="background:var(--gop);margin:0 0 0 4px"></span></span>
    </div>
    <div class="bar" role="img" aria-label="${title}: Democrats ${d}, Republicans ${g}, other ${o}, uncalled ${open}">
      ${seg(d, 'var(--dem)', 'Dem')}${seg(open, 'var(--uncalled)', 'Uncalled')}${seg(o, 'var(--oth)', 'Other')}${seg(g, 'var(--gop)', 'GOP')}
      ${need ? `<i class="tick" style="left:${pct(need) - 0.2}%"></i>` : ''}
    </div>
    <div class="bop-foot">${foot}</div>
  </div>`;
}
function renderBop() {
  const races = S.results.races;
  const h = S.config.senateHoldovers || { Dem: 0, GOP: 0 };
  const s = tally(races, 'S'), hs = tally(races, 'H'), g = tally(races, 'G');
  const html = [];
  if (s.total) {
    const total = s.total + h.Dem + h.GOP;
    html.push(bopCard('Senate', s.Dem + h.Dem, s.GOP + h.GOP, s.Oth, s.open, total, total / 2,
      `Includes ${h.Dem} D / ${h.GOP} R seats not up. Control: Dem needs 51; GOP needs 50 (VP tiebreak). Independents shown as other.`));
  }
  if (hs.total) html.push(bopCard('House', hs.Dem, hs.GOP, hs.Oth, hs.open, hs.total, 218, `${hs.total} seats tracked · 218 for majority`));
  if (g.total) html.push(bopCard('Governors', g.Dem, g.GOP, g.Oth, g.open, g.total, 0, `${g.total} races on the ballot (seats not up aren't counted)`));
  $('bop').innerHTML = html.join('') || `<div class="bop-card"><h3>Balance of power</h3><p class="sub">Appears once the results provider returns races.</p></div>`;
}

// ---------- races ----------
function margin(r) { const [a, b] = r.candidates; return a && b ? a.pct - b.pct : 100; }
function selectRaces() {
  let list = S.results.races.filter((r) => r.office === ui.office);
  const watch = (S.config.watchStates || {})[ui.office] || [];
  if (ui.q) {
    const q = ui.q.toUpperCase();
    list = list.filter((r) => (r.district || r.state).toUpperCase().includes(q) || r.title.toUpperCase().includes(q));
  } else if (ui.view === 'watch' && watch.length) {
    list = list.filter((r) => watch.includes(r.district || r.state) || watch.includes(r.state) && ui.office !== 'H')
      .sort((a, b) => watch.indexOf(a.district || a.state) - watch.indexOf(b.district || b.state));
  } else if (ui.view === 'close' || ui.view === 'watch') {
    list = list.filter((r) => !r.winnerParty && r.eevp > 0).sort((a, b) => margin(a) - margin(b));
  } else {
    list = list.sort((a, b) => (a.district || a.state).localeCompare(b.district || b.state));
  }
  return list.slice(0, 80);
}
function raceCard(r) {
  const w = r.candidates.find((c) => c.winner);
  const rep = r.eevp != null ? `${Math.round(r.eevp)}% in` : 'no votes yet';
  const cands = r.candidates.slice(0, 3).map((c) => `
    <div class="cand">
      <span class="nm">${c.winner ? '<span class="check" aria-label="winner">✓</span> ' : ''}${esc(c.name)} <span class="sub">(${esc(partyLabel(c.party))})</span></span>
      <span class="pc">${c.pct.toFixed(1)}%</span>
      <span class="vt"><span class="track"><span class="fill" style="width:${c.pct}%;background:${partyColor(c.party)}"></span></span><span class="votes">${fmtNum(c.votes)}</span></span>
    </div>`).join('');
  return `<article class="race">
    <div class="race-h"><b>${esc(r.district || r.state)}${r.special ? ' <span class="sub">special</span>' : ''}</b>
      <span class="rep">${w ? `<span class="called" style="background:${partyColor(w.party)}">${esc(partyLabel(w.party))} WIN</span> ` : r.runoff ? '<span class="sub">Runoff</span> ' : ''}${rep}</span></div>
    ${cands}
  </article>`;
}
function renderRaces() {
  const err = S.results.error;
  $('raceErr').hidden = !err;
  $('raceErr').textContent = err ? `Results: ${err}` : '';
  const list = selectRaces();
  $('raceList').innerHTML = list.length ? list.map(raceCard).join('')
    : `<p class="empty">${S.results.races.length ? 'No races match.' : 'Waiting for results…'}</p>`;
}

// ---------- markets ----------
function spark(hist) {
  if (!hist || hist.length < 2) return '';
  const W = 120, H = 32, xs = hist.map((p) => p[0]), ys = hist.map((p) => p[1]);
  const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 0.04) { const m = (hi + lo) / 2; lo = m - 0.02; hi = m + 0.02; }
  const d = hist.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) / (x1 - x0 || 1) * (W - 4) + 2).toFixed(1)},${(H - 2 - (p[1] - lo) / (hi - lo) * (H - 4)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="trend"><path d="${d}"/></svg>`;
}
function renderMarkets() {
  const { markets, errors, history } = S.markets;
  $('mktErr').hidden = !errors.length;
  $('mktErr').textContent = errors.join('\n');
  $('mktList').innerHTML = markets.length ? markets.map((m) => {
    const h = history[m.key] || [];
    const label = h.label || (m.outcomes[0] || {}).label;
    const o = m.outcomes.find((x) => x.label === label) || m.outcomes[0];
    if (!o) return '';
    const delta = h.length > 1 ? (h[h.length - 1][1] - h[0][1]) * 100 : 0;
    const others = m.outcomes.filter((x) => x !== o).slice(0, 3).map((x) => `${esc(x.label)} ${(x.prob * 100).toFixed(0)}%`).join(' · ');
    return `<div class="mkt">
      <div class="mkt-h"><span>${esc(m.source)}</span>${m.volume ? `<span>Vol ${fmtNum(Math.round(m.volume))}</span>` : ''}</div>
      <div class="mkt-t"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a></div>
      <div class="mkt-row">
        <div><span class="p">${(o.prob * 100).toFixed(0)}%</span> ${esc(o.label)}
          <div class="delta">${Math.abs(delta) >= 0.5 ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} pts` : 'unchanged'} since start</div></div>
        ${spark(h)}
      </div>
      ${others ? `<div class="mkt-others">${others}</div>` : ''}
    </div>`;
  }).join('') : '<p class="empty">Waiting for market data…</p>';
}

// ---------- calls / news / polls ----------
function renderCalls() {
  $('callList').innerHTML = S.calls.length ? S.calls.slice(0, 60).map((c) => `
    <li><span class="when">${fmtTime(c.ts)}</span> <span class="called" style="background:${partyColor(c.party)}">${esc(partyLabel(c.party))}</span>
      <b>${esc(c.title)}</b>${c.winner ? ` — ${esc(c.winner)}` : ''}${c.changed ? ' <span class="sub">(call changed)</span>' : ''}</li>`).join('')
    : '<li class="empty">No new calls since the dashboard started.</li>';
}
function renderNews() {
  const { items, errors } = S.news;
  $('newsErr').hidden = !errors.length;
  $('newsErr').textContent = errors.length ? `Some feeds failed:\n${errors.join('\n')}` : '';
  $('newsSub').textContent = items.length ? `${new Set(items.map((i) => i.source)).size} sources` : '';
  $('newsList').innerHTML = items.length ? items.map((i) => `
    <li><span class="src">${esc(i.source)}</span><span class="when">${ago(i.ts)}</span>${i.ts && Date.now() - i.ts < 15 * 60000 ? '<span class="fresh">NEW</span>' : ''}<br>
      <a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></li>`).join('')
    : '<li class="empty">Waiting for headlines…</li>';
}
function closings() {
  const base = Date.parse(`${(S && S.config.electionDate) || '2026-11-03'}T00:00:00-05:00`); // EST (DST ends Nov 1, 2026)
  return window.POLL_CLOSINGS.map((c) => ({ ...c, at: base + (c.t[0] * 60 + c.t[1]) * 60000 }));
}
function renderPolls() {
  const now = Date.now(), list = closings();
  const next = list.find((c) => c.at > now);
  $('pollList').innerHTML = list.map((c) => `<li class="${c.at <= now ? 'past' : c === next ? 'next' : ''}">
    <span>${fmtTime(c.at)}</span><span>${c.states.join(', ')}</span></li>`).join('');
  if (next) {
    const mins = Math.round((next.at - now) / 60000);
    const d = mins >= 1440 ? `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h` : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    $('nextClose').textContent = `Next poll close in ${d} (${next.states.slice(0, 4).join(', ')}${next.states.length > 4 ? '…' : ''})`;
  } else $('nextClose').textContent = 'All polls closed';
}
function renderStatus() {
  const dot = (name, upd, bad) => `<span class="dot ${!upd ? '' : bad ? 'bad' : 'ok'}" title="${upd ? 'updated ' + ago(upd) : 'not yet loaded'}">${name}</span>`;
  $('status').innerHTML = dot('Results', S.results.updated, S.results.error) + dot('Markets', S.markets.updated, S.markets.errors.length)
    + dot('News', S.news.updated, S.news.errors.length);
  $('demoBadge').hidden = !S.demo;
  $('credit').textContent = `Results: ${S.results.provider || '—'}${S.results.updated ? ` · updated ${fmtTime(S.results.updated)} ET` : ''} · Markets: Kalshi, Polymarket, PredictIt · Headlines link to their publishers`;
}

function renderAll() { renderBop(); renderRaces(); renderMarkets(); renderCalls(); renderNews(); renderPolls(); renderStatus(); }

async function refresh() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    S = await r.json();
    renderAll();
  } catch (e) {
    $('status').innerHTML = '<span class="dot bad">Server unreachable</span>';
  }
}

function tick() { $('clock').textContent = new Date().toLocaleTimeString('en-US', { ...ET, hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' ET'; if (S) renderPolls(); }

$('officeTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  ui.office = b.dataset.office;
  [...$('officeTabs').children].forEach((x) => x.classList.toggle('on', x === b));
  if (S) renderRaces();
});
$('viewSel').addEventListener('change', (e) => { ui.view = e.target.value; if (S) renderRaces(); });
$('search').addEventListener('input', (e) => { ui.q = e.target.value.trim(); if (S) renderRaces(); });

tick(); setInterval(tick, 1000);
refresh(); setInterval(refresh, 10000);
