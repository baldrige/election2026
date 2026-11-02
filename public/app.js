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

const ui = { feedsOpen: false, office: 'S', view: 'default', q: '' };
let S = null; // last server state

// ---------- balance of power ----------
// Solid = seats not up (Senate) plus races called per civicAPI; light = leading the count, not called.
function balance(office) {
  const t = { called: { Dem: 0, GOP: 0, Oth: 0 }, lead: { Dem: 0, GOP: 0, Oth: 0 }, n: 0 };
  const P = (p) => (p === 'Dem' || p === 'GOP' ? p : 'Oth');
  for (const r of S.results.races) {
    if (r.office !== office) continue;
    t.n++;
    if (r.winnerParty) { t.called[P(r.winnerParty)]++; continue; }
    const [a, b] = r.candidates;
    if (a && a.votes && !(b && a.votes === b.votes)) t.lead[P(a.party)]++;
  }
  return t;
}
function bopCard({ title, total, majority, base = { Dem: 0, GOP: 0 }, t, foot }) {
  const d = base.Dem + t.called.Dem, r = base.GOP + t.called.GOP;
  const rest = total - d - r - t.called.Oth - t.lead.Dem - t.lead.GOP - t.lead.Oth;
  const pct = (n) => (100 * n) / total;
  const seg = (n, color, cls, label) => n > 0 ? `<span class="${cls}" style="width:${pct(n)}%;background:${color}" title="${label}: ${n}"></span>` : '';
  const plus = (n) => n ? ` <span class="plus">+${n} leading</span>` : '';
  return `<div class="bop-card">
    <h3>${title}</h3>
    <div class="bop-nums">
      <span class="d"><span class="sw" style="background:var(--dem)"></span><span class="lab">Dem</span> <b>${d}</b>${plus(t.lead.Dem)}</span>
      <span class="d">${plus(t.lead.GOP)} <b>${r}</b> <span class="lab">GOP</span><span class="sw" style="background:var(--gop);margin:0 0 0 4px"></span></span>
    </div>
    <div class="bar" role="img" aria-label="${title}: Democrats ${d} plus ${t.lead.Dem} leading; Republicans ${r} plus ${t.lead.GOP} leading; other ${t.called.Oth} plus ${t.lead.Oth} leading; ${rest} no count">
      ${seg(d, 'var(--dem)', '', 'Dem')}${seg(t.lead.Dem, 'var(--dem)', 'lead', 'Dem leading')}${seg(rest, 'var(--uncalled)', '', 'No count yet')}${seg(t.called.Oth, 'var(--oth)', '', 'Other')}${seg(t.lead.Oth, 'var(--oth)', 'lead', 'Other leading')}${seg(t.lead.GOP, 'var(--gop)', 'lead', 'GOP leading')}${seg(r, 'var(--gop)', '', 'GOP')}
      ${majority ? `<i class="tick" style="left:${pct(majority) - 0.2}%"></i>` : ''}
    </div>
    <div class="bop-foot">${rest} no count yet${t.called.Oth + t.lead.Oth ? ` · other: ${t.called.Oth} called, ${t.lead.Oth} leading` : ''} · ${foot}</div>
  </div>`;
}
function renderBop() {
  const h = S.config.senateHoldovers || { Dem: 0, GOP: 0 };
  const sT = balance('S'), gT = balance('G'), hT = balance('H');
  $('bop').innerHTML =
    bopCard({ title: 'Senate', total: 100, majority: 50, base: h, t: sT, foot: `incl. ${h.Dem} D / ${h.GOP} R not up · ${sT.n} of 35 races tracked · Dem needs 51, GOP 50 (VP tiebreak)` })
    + bopCard({ title: 'House', total: 435, majority: 218, t: hT, foot: `${hT.n} of 435 districts tracked · 218 for majority` })
    + bopCard({ title: 'Governors', total: 36, t: gT, foot: `${gT.n} of 36 races tracked` })
    + `<div class="bop-key"><span><i style="background:var(--ink-2)"></i>Called per civicAPI${h.Dem ? ' (Senate: + seats not up)' : ''}</span><span><i style="background:var(--ink-2);opacity:.45"></i>Leading the count, not called</span><span><i style="background:var(--uncalled)"></i>No count yet</span></div>`;
}

// ---------- races ----------
function margin(r) { const [a, b] = r.candidates; return a && b ? a.pct - b.pct : 100; }
function selectRaces() {
  let list = S.results.races.filter((r) => r.office === ui.office);
  const az = (a, b) => (a.district || a.state).localeCompare(b.district || b.state) || (a.special ? 1 : 0) - (b.special ? 1 : 0);
  const view = ui.view === 'default' ? (ui.office === 'H' ? 'close' : 'all') : ui.view;
  if (ui.q) {
    const q = ui.q.toUpperCase().replace(/\s+/g, '');
    list = list.filter((r) => (r.district || r.state).toUpperCase().replace('-', '').includes(q.replace('-', '')) || r.title.toUpperCase().includes(q));
  }
  if (view === 'close') list = list.filter((r) => !r.winnerParty && r.candidates[0] && r.candidates[0].votes).sort((a, b) => margin(a) - margin(b));
  else if (view === 'called') list = list.filter((r) => r.winnerParty).sort(az);
  else list = list.sort(az);
  return list;
}
// Market odds under the tally: one line per platform, top two outcomes.
function oddsBlock(r) {
  if (!r.odds) return '';
  const lab = (x) => x.p && (x.p === 'Dem' || x.p === 'GOP') ? partyLabel(x.p) : x.n ? x.n.split(' ').slice(-1)[0] : partyLabel(x.p);
  const rows = Object.entries(r.odds).map(([src, d]) => {
    // Keep D left / R right when both parties are listed, so columns line up across rows and cards.
    const two = d.o.slice(0, 2), rank = { Dem: 0, GOP: 1 };
    if (two.every((x) => x.p in rank)) two.sort((a, b) => rank[a.p] - rank[b.p]);
    const top = two.map((x) => `<span title="${esc(x.n || partyLabel(x.p))}${x.p && x.n ? ` (${esc(partyLabel(x.p))})` : ''}"><i class="sw" style="background:${x.p ? partyColor(x.p) : 'var(--ink-3)'}"></i>${esc(lab(x))} <b>${Math.round(x.v * 100)}%</b></span>`).join('');
    return `<div class="odds-row"><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(src)}</a>${top}</div>`;
  }).join('');
  return `<div class="race-odds" title="Prediction-market prices: traders' bets, not results">${rows}</div>`;
}
function raceCard(r) {
  const w = r.candidates.find((c) => c.winner);
  // Before any votes are counted, sources can still report units as "reporting" (blank uploads),
  // so show "No votes yet" and keep the source's own figure in the tooltip.
  const noVotes = !r.candidates.some((c) => c.votes > 0);
  const srcRep = r.reportingLabel || (r.eevp != null ? `${Math.round(r.eevp)}% in` : '');
  const rep = noVotes ? `<span title="${esc(srcRep ? `Source says: ${srcRep}` : '')}">No votes yet</span>` : esc(srcRep || 'reporting unknown');
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
    ${oddsBlock(r)}
    ${r.source ? `<div class="race-src">${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}${r.calledBy ? ` · called per ${esc(r.calledBy)}` : ' · not called'}${r.lastUpdated ? ` · ${ago(Date.parse(r.lastUpdated))}` : ''}</div>` : ''}
  </article>`;
}
function renderRaces() {
  const err = S.results.error;
  $('raceErr').hidden = !err;
  $('raceErr').textContent = err ? `Results: ${err}` : '';
  const feeds = S.results.feeds || [];
  $('feedStatus').hidden = !feeds.length;
  $('feedStatus').innerHTML = feeds.length ? `<details${ui.feedsOpen ? ' open' : ''}><summary>Results sources: ${feeds.filter((f) => f.ok).length} of ${feeds.filter((f) => !f.info).length} working${feeds.some((f) => f.info) ? ` · ${feeds.filter((f) => f.info).map((f) => f.state).join(', ')} have no state feed` : ''}</summary><ul>${
    feeds.map((f) => `<li><span class="dot ${f.ok ? 'ok' : f.info ? '' : 'bad'}">${esc(f.state)}</span> ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.message)}</a>` : esc(f.message)}${f.stale ? ' (showing last good data)' : ''}${f.updated ? ` <span class="sub">· ${ago(f.updated)}</span>` : ''}</li>`).join('')}</ul></details>` : '';
  const all = selectRaces(), list = all.slice(0, 90);
  const total = S.results.races.filter((r) => r.office === ui.office).length;
  $('raceList').innerHTML = list.length ? list.map(raceCard).join('') + (all.length > list.length ? `<p class="more">Showing ${list.length} of ${all.length}. Search a state or district to narrow.</p>` : '')
    : `<p class="empty">${total ? (ui.view === 'close' || (ui.view === 'default' && ui.office === 'H') ? 'No uncalled races with votes yet. Choose "All" to see every race.' : 'No races match.') : 'Waiting for results…'}</p>`;
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
const pct0 = (p) => `${Math.round(p * 100)}%`;
function deltaText(h, short = false) {
  const d = h && h.length > 1 ? (h[h.length - 1][1] - h[0][1]) * 100 : 0;
  if (Math.abs(d) < 0.5) return short ? '—' : 'unchanged since start';
  return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${short ? '' : ' pts Dem since start'}`;
}
// One widget per question (e.g. "House control"): average across platforms + a row per platform.
function groupWidget(g, history) {
  const h = history[`group:${g.key}`] || [];
  const vol = g.rows.some((r) => r.volume);
  const rows = g.rows.map((r) => `<tr>
      <td><a href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(r.source)}</a>${r.stale ? ` <span class="sub">as of ${fmtTime(r.asOf)}</span>` : ''}</td>
      <td class="num">${pct0(r.dem)}</td><td class="num">${pct0(r.gop)}</td>
      <td class="num sub">${deltaText(history[r.key], true)}</td>
      ${vol ? `<td class="num sub">${r.volume ? fmtNum(Math.round(r.volume)) : ''}</td>` : ''}</tr>`).join('');
  return `<div class="mkt">
    <div class="mkt-t">${esc(g.label)}</div>
    <div class="mkt-split">
      <span><span class="sw" style="background:var(--dem)"></span>Dem <b>${pct0(g.dem)}</b></span>
      <span><b>${pct0(g.gop)}</b> GOP<span class="sw" style="background:var(--gop);margin:0 0 0 4px"></span></span>
    </div>
    <div class="bar" role="img" aria-label="${esc(g.label)}: Democrats ${pct0(g.dem)}, Republicans ${pct0(g.gop)}">
      <span style="width:${g.dem * 100}%;background:var(--dem)"></span><span style="width:${g.gop * 100}%;background:var(--gop)"></span><i class="tick"></i>
    </div>
    <div class="mkt-row"><div class="delta">${g.rows.length > 1 ? `Average of ${g.rows.length} markets` : '1 market'} · ${deltaText(h)}</div>${spark(h)}</div>
    <table class="mkt-tbl"><thead><tr><th>Market</th><th class="num">Dem</th><th class="num">GOP</th><th class="num" title="Change in Democratic probability since the dashboard started">Δ Dem</th>${vol ? '<th class="num">Volume</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
function otherCard(m, history) {
  const h = history[m.key] || [];
  const label = h.label || (m.outcomes[0] || {}).label;
  const o = m.outcomes.find((x) => x.label === label) || m.outcomes[0];
  if (!o) return '';
  const others = m.outcomes.filter((x) => x !== o).slice(0, 3).map((x) => `${esc(x.label)} ${pct0(x.prob)}`).join(' · ');
  return `<div class="mkt">
    <div class="mkt-h"><span>${esc(m.source)}${m.stale ? ` · <b>as of ${fmtTime(m.asOf)}</b>` : ''}</span>${m.volume ? `<span>Vol ${fmtNum(Math.round(m.volume))}</span>` : ''}</div>
    <div class="mkt-t"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a></div>
    <div class="mkt-row"><div><span class="p">${pct0(o.prob)}</span> ${esc(o.label)}<div class="delta">${deltaText(h).replace(' Dem', '')}</div></div>${spark(h)}</div>
    ${others ? `<div class="mkt-others">${others}</div>` : ''}
  </div>`;
}
function renderMarkets() {
  const { groups = [], markets, errors, history } = S.markets;
  $('mktErr').hidden = !errors.length;
  $('mktErr').textContent = errors.join('\n');
  const html = groups.map((g) => groupWidget(g, history)).join('') + markets.map((m) => otherCard(m, history)).join('');
  $('mktList').innerHTML = html || '<p class="empty">Waiting for market data…</p>';
}

// ---------- calls / news / polls ----------
function renderCalls() {
  $('callList').innerHTML = S.calls && S.calls.length ? S.calls.slice(0, 80).map((c) => `
    <li><span class="when">${fmtTime(c.ts)}</span> <span class="called" style="background:${partyColor(c.party)}">${esc(partyLabel(c.party))}</span>
      <b>${esc(c.title)}</b>${c.winner ? ` — ${esc(c.winner)}` : ''}${c.changed ? ' <span class="sub">(call changed)</span>' : ''}</li>`).join('')
    : `<li class="empty">${S.results.civic ? 'No new calls since the dashboard started.' : 'Calls come from civicAPI, which is turned off.'}</li>`;
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
  $('credit').innerHTML = `Results: ${esc(S.results.provider || '—')}${S.results.updated ? ` · updated ${fmtTime(S.results.updated)} ET` : ''}${S.results.civic ? ' · Governor, House and some Senate data and all race calls: <a href="https://civicapi.org" target="_blank" rel="noopener">civicAPI (civicapi.org)</a>' : ''} · State-site figures are unofficial election-night counts · Markets: Kalshi, Polymarket, PredictIt · Headlines link to their publishers`;
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
$('feedStatus').addEventListener('toggle', (e) => { ui.feedsOpen = e.target.open; }, true);

tick(); setInterval(tick, 1000);
refresh(); setInterval(refresh, 10000);
