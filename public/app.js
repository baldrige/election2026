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

const ui = { feedsOpen: false };
let S = null; // last server state

// ---------- Senate balance ----------
// States don't call races, so this shows seats not on the ballot (solid) plus who LEADS the
// count in each tracked race (light). Leading is not winning; the card says so.
function renderBop() {
  const h = S.config.senateHoldovers || { Dem: 0, GOP: 0 };
  const lead = { Dem: 0, GOP: 0, Oth: 0 };
  const tracked = S.results.races.filter((r) => r.office === 'S');
  for (const r of tracked) {
    const [a, b] = r.candidates;
    if (!a || !a.votes || (b && a.votes === b.votes)) continue;
    lead[a.party === 'Dem' || a.party === 'GOP' ? a.party : 'Oth']++;
  }
  const rest = 100 - h.Dem - h.GOP - lead.Dem - lead.GOP - lead.Oth;
  const seg = (n, color, cls, label) => n > 0 ? `<span class="${cls}" style="width:${n}%;background:${color}" title="${label}: ${n}"></span>` : '';
  const plus = (n) => n ? ` <span class="plus">+${n} leading</span>` : '';
  $('bop').innerHTML = `<div class="bop-card">
    <h3>Senate</h3>
    <div class="bop-nums">
      <span class="d"><span class="sw" style="background:var(--dem)"></span><span class="lab">Dem</span> <b>${h.Dem}</b>${plus(lead.Dem)}</span>
      <span class="d">${plus(lead.GOP)} <b>${h.GOP}</b> <span class="lab">GOP</span><span class="sw" style="background:var(--gop);margin:0 0 0 4px"></span></span>
    </div>
    <div class="bar" role="img" aria-label="Senate: Democrats ${h.Dem} not up plus ${lead.Dem} leading; Republicans ${h.GOP} not up plus ${lead.GOP} leading; ${rest} other">
      ${seg(h.Dem, 'var(--dem)', '', 'Dem, not up')}${seg(lead.Dem, 'var(--dem)', 'lead', 'Dem leading')}${seg(rest, 'var(--uncalled)', '', 'No count / not tracked')}${seg(lead.Oth, 'var(--oth)', 'lead', 'Other leading')}${seg(lead.GOP, 'var(--gop)', 'lead', 'GOP leading')}${seg(h.GOP, 'var(--gop)', '', 'GOP, not up')}
      <i class="tick" style="left:${50 - 0.2}%"></i>
    </div>
    <div class="bop-key">
      <span><i style="background:var(--ink-2)"></i>Seats not up in 2026</span>
      <span><i style="background:var(--ink-2);opacity:.45"></i>Leading the count (not called)</span>
      <span><i style="background:var(--uncalled)"></i>No count yet / not tracked: ${rest}</span>${lead.Oth ? `
      <span><i style="background:var(--oth);opacity:.45"></i>Other candidate leading: ${lead.Oth}</span>` : ''}
    </div>
    <div class="bop-foot">${tracked.length} of 35 races on the ballot are tracked from state sites. Control: Dem needs 51; GOP needs 50 (VP tiebreak). Leads can change as votes are counted — follow the news panel for race calls.</div>
  </div>`;
}

// ---------- races ----------
function selectRaces() {
  return S.results.races.filter((r) => r.office === 'S').sort((a, b) => a.state.localeCompare(b.state) || (a.special ? 1 : 0) - (b.special ? 1 : 0));
}
function raceCard(r) {
  const w = r.candidates.find((c) => c.winner);
  const rep = r.reportingLabel || (r.eevp != null ? `${Math.round(r.eevp)}% in` : 'no votes yet');
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
    ${r.source ? `<div class="race-src">${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}${r.countsOnly ? ' · counts only, not called' : ''}${r.lastUpdated ? ` · ${ago(Date.parse(r.lastUpdated))}` : ''}</div>` : ''}
  </article>`;
}
function renderRaces() {
  const err = S.results.error;
  $('raceErr').hidden = !err;
  $('raceErr').textContent = err ? `Results: ${err}` : '';
  const feeds = S.results.feeds || [];
  $('feedStatus').hidden = !feeds.length;
  $('feedStatus').innerHTML = feeds.length ? `<details${ui.feedsOpen ? ' open' : ''}><summary>State results feeds: ${feeds.filter((f) => f.ok).length} of ${feeds.filter((f) => !f.info).length} working${feeds.some((f) => f.info) ? ` · ${feeds.filter((f) => f.info).map((f) => f.state).join(', ')} have no state feed` : ''}</summary><ul>${
    feeds.map((f) => `<li><span class="dot ${f.ok ? 'ok' : f.info ? '' : 'bad'}">${esc(f.state)}</span> ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.message)}</a>` : esc(f.message)}${f.stale ? ' (showing last good data)' : ''}${f.updated ? ` <span class="sub">· ${ago(f.updated)}</span>` : ''}</li>`).join('')}</ul></details>` : '';
  const list = selectRaces();
  $('raceList').innerHTML = list.length ? list.map(raceCard).join('')
    : '<p class="empty">Waiting for state results…</p>';
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

// ---------- news / polls ----------
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
  $('credit').textContent = `Results: ${S.results.provider || '—'}${S.results.updated ? ` · updated ${fmtTime(S.results.updated)} ET` : ''} · Markets: Kalshi, Polymarket, PredictIt · Headlines link to their publishers${(S.results.feeds || []).length ? ' · State-site figures are unofficial election-night counts' : ''}`;
}

function renderAll() { renderBop(); renderRaces(); renderMarkets(); renderNews(); renderPolls(); renderStatus(); }

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

$('feedStatus').addEventListener('toggle', (e) => { ui.feedsOpen = e.target.open; }, true);

tick(); setInterval(tick, 1000);
refresh(); setInterval(refresh, 10000);
