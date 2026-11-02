'use strict';
// Race map at the top of each Races tab, shaded by prediction-market odds (Dem vs GOP).
// Senate/Governor: state outlines (us-states.json). House: tile map, one square per district,
// grouped by state (2026 district lines changed in several states, so no geographic House map).
(function () {
  const BINS = [
    { min: 0.85, label: 'Solid D', range: '≥85%' }, { min: 0.65, label: 'Likely D', range: '65–85%' }, { min: 0.55, label: 'Lean D', range: '55–65%' },
    { min: 0.45, label: 'Toss-up', range: '45–55%' },
    { min: 0.35, label: 'Lean R', range: '55–65%' }, { min: 0.15, label: 'Likely R', range: '65–85%' }, { min: -1, label: 'Solid R', range: '≥85%' },
  ];
  // Tile-map grid (col, row) for the House view.
  const TILE = { AK: [0, 0], ME: [11, 0], WI: [6, 1], VT: [10, 1], NH: [11, 1], WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], MI: [7, 2], NY: [9, 2], MA: [10, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3], RI: [11, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
    OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6], HI: [0, 7], TX: [4, 7], FL: [9, 7] };

  let geo = null;
  fetch('/us-states.json').then((r) => r.json()).then((g) => { geo = g; if (window.renderRaces && window.S) window.renderRaces(); }).catch(() => {});

  // Average Democratic share of the two-party market price across platforms.
  // Returns { d, sources } or { other: true } when a non-major candidate is favoured, or null when no party market.
  function marketDem(r) {
    if (!r.odds) return null;
    const ds = [];
    let other = 0, n = 0;
    for (const d of Object.values(r.odds)) {
      let pD = 0, pR = 0, pO = 0;
      for (const x of d.o) { if (x.p === 'Dem') pD += x.v; else if (x.p === 'GOP') pR += x.v; else if (x.p) pO += x.v; }
      if (pD + pR + pO === 0) continue; // candidate-only market (e.g. top-two): no party to shade by
      n++;
      if (pO > Math.max(pD, pR)) { other++; continue; }
      if (pD + pR > 0) ds.push(pD / (pD + pR));
    }
    if (!n) return null;
    if (other > n / 2) return { other: true };
    return ds.length ? { d: ds.reduce((a, b) => a + b, 0) / ds.length } : null;
  }
  const binOf = (d) => BINS.findIndex((b) => d >= b.min);
  function fillFor(r) {
    if (!r) return { fill: 'var(--map-none)', cls: 'none' };
    const m = marketDem(r);
    if (!m) return { fill: 'url(#map-hatch)', cls: 'nomkt' };
    if (m.other) return { fill: 'var(--oth)', cls: 'oth' };
    return { fill: `var(--div-${binOf(m.d)})`, cls: 'mkt' };
  }

  function tipHtml(r, esc) {
    if (!r) return '';
    const m = marketDem(r);
    const head = `<b>${esc(r.title)}</b>`;
    if (!r.odds) return `${head}<div>No prediction market found</div>`;
    const lines = Object.entries(r.odds).map(([src, d]) => `<div>${esc(src)}: ${d.o.slice(0, 3).map((x) => `${esc(x.n || x.p || '?')}${x.p && x.n ? ` (${esc(x.p === 'Dem' ? 'D' : x.p === 'GOP' ? 'R' : x.p)})` : ''} ${Math.round(x.v * 100)}%`).join(', ')}</div>`).join('');
    const sum = m && !m.other ? `<div class="tip-sum">${BINS[binOf(m.d)].label} · Dem ${Math.round(m.d * 100)}% / GOP ${Math.round((1 - m.d) * 100)}% (avg.)</div>` : m && m.other ? '<div class="tip-sum">Non-major-party candidate favoured</div>' : '<div class="tip-sum">Markets list candidates without parties</div>';
    return head + sum + lines;
  }

  const defs = '<defs><pattern id="map-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--map-none)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-3)" stroke-width="1.4"/></pattern></defs>';

  function stateMap(races, office, esc, selected) {
    if (!geo) return '<p class="empty">Loading map…</p>';
    const by = new Map(); for (const r of races) if (r.office === office && !by.has(r.state)) by.set(r.state, r);
    const paths = Object.entries(geo.states).map(([st, d]) => {
      const r = by.get(st), f = fillFor(r);
      return `<path d="${d}" fill="${f.fill}" class="st ${f.cls}${selected === st ? ' sel' : ''}" data-st="${st}" data-id="${r ? esc(r.id) : ''}"><title>${st}</title></path>`;
    }).join('');
    return `<svg viewBox="${geo.viewBox}" class="map-svg" role="img" aria-label="${office === 'S' ? 'Senate' : 'Governor'} races shaded by prediction-market odds">${defs}${paths}</svg>`;
  }

  function houseMap(races, esc, selected) {
    const byState = new Map();
    for (const r of races) if (r.office === 'H') (byState.get(r.state) || byState.set(r.state, []).get(r.state)).push(r);
    if (!byState.size) return '<p class="empty">Waiting for House results…</p>';
    const T = 60, W = 54, H = 44, out = [];
    for (const [st, [c, rw]] of Object.entries(TILE)) {
      const list = (byState.get(st) || []).sort((a, b) => a.district.localeCompare(b.district, 'en', { numeric: true }));
      const x0 = c * T, y0 = rw * T;
      out.push(`<text x="${x0 + 3}" y="${y0 + 11}" class="tile-lab${selected === st ? ' sel' : ''}" data-st="${st}">${st}</text>`);
      if (!list.length) continue;
      const cols = Math.ceil(Math.sqrt(list.length * W / H)), rows = Math.ceil(list.length / cols);
      const s = Math.min(W / cols, H / rows);
      list.forEach((r, i) => {
        const f = fillFor(r);
        out.push(`<rect x="${(x0 + 3 + (i % cols) * s).toFixed(1)}" y="${(y0 + 14 + Math.floor(i / cols) * s).toFixed(1)}" width="${Math.max(1, s - 1).toFixed(1)}" height="${Math.max(1, s - 1).toFixed(1)}" rx="1" fill="${f.fill}" class="dist ${f.cls}" data-st="${st}" data-id="${esc(r.id)}"/>`);
      });
      if (selected === st) out.push(`<rect x="${x0 + 1}" y="${y0 + 1}" width="${T - 2}" height="${T - 2}" class="tile-sel"/>`);
    }
    return `<svg viewBox="0 0 ${12 * T} ${8 * T}" class="map-svg house" role="img" aria-label="House districts shaded by prediction-market odds, one square per district">${defs}${out.join('')}</svg>`;
  }

  function legend(office) {
    const sw = BINS.map((b, i) => `<span><i style="background:var(--div-${i})"></i>${b.label}<small>${b.range}</small></span>`).join('');
    return `<div class="map-legend">${sw}<span><i class="hatch"></i>No party market</span><span><i style="background:var(--map-none)"></i>${office === 'H' ? 'No data' : 'No race'}</span></div>`;
  }

  // Public: render into el. onPick(state) is called when a state/district is clicked.
  window.renderRaceMap = function (el, races, office, { esc, selected, onPick }) {
    const inner = office === 'H' ? houseMap(races, esc, selected) : stateMap(races, office, esc, selected);
    const counts = { mkt: 0, total: 0 };
    for (const r of races) if (r.office === office) { counts.total++; if (marketDem(r) && !marketDem(r).other) counts.mkt++; }
    el.innerHTML = `<div class="map-wrap">${inner}<div class="map-tip" hidden></div></div>${legend(office)}<div class="map-note">Shaded by the average Democratic vs. Republican price on Kalshi and Polymarket (${counts.mkt} of ${counts.total} races have a party market). Traders' bets, not results. ${office === 'H' ? 'One square per district, grouped by state. ' : ''}Click a state to filter the cards.</div>`;
    const byId = new Map(races.map((r) => [r.id, r]));
    const tip = el.querySelector('.map-tip'), wrap = el.querySelector('.map-wrap');
    el.onmousemove = (e) => {
      const t = e.target.closest('[data-id]');
      const r = t && byId.get(t.dataset.id);
      if (!r) { tip.hidden = true; return; }
      tip.innerHTML = tipHtml(r, esc); tip.hidden = false;
      const b = wrap.getBoundingClientRect();
      let x = e.clientX - b.left + 12, y = e.clientY - b.top + 12;
      if (x + 240 > b.width) x = Math.max(0, e.clientX - b.left - 252);
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    };
    el.onmouseleave = () => { tip.hidden = true; };
    el.onclick = (e) => { const t = e.target.closest('[data-st]'); if (t) onPick(t.dataset.st); };
  };
  window.marketDem = marketDem;
})();
