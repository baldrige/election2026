'use strict';
// Starred races and alerts. Everything is per viewer (browser storage); the server is untouched.
// The detection logic (AlertCore) is pure so it can be tested in Node: tools/test-alerts.js.
(function (root) {
  // ---------- pure logic ----------
  const keyOf = (r) => `${r.office}:${r.district || r.state}`; // stable across sources (state feed, civicAPI, pending)
  const OFFICE = { S: 'Senate', G: 'Governor', H: 'House' };
  const PARTY = { Dem: 'Democrat', GOP: 'Republican' };
  const pct = (x) => `${Math.round(x * 100)}%`;

  const DEFAULTS = {
    calls: 'senate-gov', // off | starred | senate-gov (all Senate & Governor + starred House) | all
    leads: true,         // lead changes in starred races
    swings: true,        // market moves on control widgets + starred races
    swingPts: 10, swingMin: 15,
    minVotes: 1000,      // lead changes only count once a race has this many votes
    sound: false, desktop: false,
  };

  // Average Democratic share of the two-party price across platforms (null if no party market).
  function marketDem(odds) {
    if (!odds) return null;
    const ds = [];
    for (const d of Object.values(odds)) {
      let pD = 0, pR = 0;
      for (const x of d.o || []) { if (x.p === 'Dem') pD += x.v; else if (x.p === 'GOP') pR += x.v; }
      if (pD + pR > 0) ds.push(pD / (pD + pR));
    }
    return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
  }

  function wantsCall(c, settings, stars) {
    const key = c.key || '';
    if (settings.calls === 'off') return false;
    if (settings.calls === 'all') return true;
    if (stars.has(key)) return true;
    return settings.calls === 'senate-gov' && (c.office === 'S' || c.office === 'G');
  }

  // state: previous detector state (or null on first run). Returns { alerts, state }.
  function detect(prev, S, settings, stars, now = Date.now(), storedLastCallTs = null) {
    const st = prev ? { ...prev, leaders: { ...prev.leaders }, samples: { ...prev.samples } } : { leaders: {}, samples: {}, lastCallTs: 0 };
    const alerts = [];
    const calls = S.calls || [];
    const newestTs = calls.reduce((m, c) => Math.max(m, c.ts || 0), 0);

    // 1. Calls, from the server's call log (so reloads/restarts neither repeat nor skip).
    // First run: catch up on calls since this browser last looked, but at most 10 minutes back
    // (reopening after hours shouldn't fire dozens of old calls); with no history, start from now.
    if (!prev) st.lastCallTs = storedLastCallTs != null ? Math.max(storedLastCallTs, now - 10 * 60000) : newestTs;
    for (const c of [...calls].reverse()) {
      if (!(c.ts > st.lastCallTs)) continue;
      if (wantsCall(c, settings, stars)) {
        alerts.push({ kind: 'call', key: c.key, ts: now, title: `${c.changed ? 'Call changed' : 'Race called'}: ${c.title}`,
          body: `${c.winner ? `${c.winner} (${c.party === 'Dem' ? 'D' : c.party === 'GOP' ? 'R' : c.party})` : PARTY[c.party] || c.party} wins${c.by ? `, per ${c.by}` : ''}${c.afterRestart ? ' (found after a restart)' : ''}` });
      }
    }
    st.lastCallTs = Math.max(st.lastCallTs, newestTs);

    // 2. Lead changes in starred races (only with real counts on both sides).
    for (const r of (S.results && S.results.races) || []) {
      const key = keyOf(r);
      if (r.pending || r.winnerParty) continue;
      const [a, b] = r.candidates || [];
      if (!a || !b || !a.votes || !b.votes || a.votes + b.votes < settings.minVotes || a.votes === b.votes) continue;
      const leader = a.party === 'Dem' || a.party === 'GOP' ? a.party : `${a.party}:${a.name}`;
      const before = st.leaders[key];
      st.leaders[key] = leader;
      if (prev && settings.leads && stars.has(key) && before && before !== leader) {
        const m = (a.pct - b.pct).toFixed(1);
        alerts.push({ kind: 'lead', key, ts: now, title: `Lead change: ${r.title}`, body: `${a.name} (${a.party === 'Dem' ? 'D' : a.party === 'GOP' ? 'R' : a.party}) now leads by ${m} pts${r.reportingLabel ? `, ${r.reportingLabel}` : ''}` });
      }
    }

    // 3. Market swings: control widgets (all) and starred races.
    const series = [];
    for (const g of (S.markets && S.markets.groups) || []) series.push({ key: `mkt:${g.key}`, raceKey: null, label: g.label, d: g.dem });
    const seen = new Set();
    for (const r of (S.results && S.results.races) || []) {
      const key = keyOf(r);
      if (!stars.has(key) || seen.has(key)) continue;
      seen.add(key);
      const d = marketDem(r.odds || (S.mapOdds || {})[key]);
      if (d != null) series.push({ key: `race:${key}`, raceKey: key, label: `${r.title} odds`, d });
    }
    const windowMs = settings.swingMin * 60000, need = settings.swingPts / 100;
    for (const s of series) {
      const pts = (st.samples[s.key] || []).filter(([t]) => now - t <= windowMs);
      if (prev && settings.swings && pts.length) {
        const lo = pts.reduce((m, p) => (p[1] < m[1] ? p : m)), hi = pts.reduce((m, p) => (p[1] > m[1] ? p : m));
        const up = s.d - lo[1], down = hi[1] - s.d;
        if (up >= need || down >= need) {
          const from = up >= down ? lo[1] : hi[1];
          const mins = Math.max(1, Math.round((now - (up >= down ? lo[0] : hi[0])) / 60000));
          alerts.push({ kind: 'swing', key: s.raceKey, ts: now, title: `Market swing: ${s.label}`,
            body: `Democrats ${pct(from)} → ${pct(s.d)} (${s.d > from ? '+' : '−'}${Math.round(Math.abs(s.d - from) * 100)} pts in ${mins} min)` });
          st.samples[s.key] = [[now, s.d]]; // start a new window so one move alerts once
          continue;
        }
      }
      pts.push([now, s.d]);
      st.samples[s.key] = pts;
    }
    return { alerts, state: st };
  }

  const AlertCore = { keyOf, detect, marketDem, wantsCall, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = AlertCore; return; }
  root.AlertCore = AlertCore;

  // ---------- browser: storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`end.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`end.${k}`, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };
  const stars = new Set(store.get('stars', []));
  const settings = { ...DEFAULTS, ...store.get('alertSettings', {}) };
  let log = store.get('alertLog', []);
  let unseen = 0, detector = null;

  root.Stars = {
    keyOf, has: (r) => stars.has(typeof r === 'string' ? r : keyOf(r)), count: () => stars.size,
    toggle(key) { stars.has(key) ? stars.delete(key) : stars.add(key); store.set('stars', [...stars]); },
  };

  // ---------- browser: delivery ----------
  let audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      [[880, 0], [660, 0.18]].forEach(([f, at]) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        const t = audio.currentTime + at;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t); o.stop(t + 0.18);
      });
    } catch { /* no audio */ }
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function jump(key) { if (key && root.jumpToRace) root.jumpToRace(key); }

  function toast(a) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${a.kind}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<b>${esc(a.title)}</b><div>${esc(a.body)}</div><button class="toast-x" aria-label="Dismiss">×</button>`;
    el.onclick = (e) => { if (!e.target.classList.contains('toast-x')) jump(a.key); el.remove(); };
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 20000);
  }
  function desktop(a) {
    if (!settings.desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { const n = new Notification(a.title, { body: a.body, tag: `${a.kind}:${a.key || ''}` }); n.onclick = () => { window.focus(); jump(a.key); n.close(); }; } catch { /* ignore */ }
  }
  function deliver(alerts) {
    if (!alerts.length) return;
    for (const a of alerts) { toast(a); desktop(a); }
    if (settings.sound) beep();
    log = [...alerts.reverse(), ...log].slice(0, 50);
    store.set('alertLog', log);
    const panel = document.getElementById('alertPanel');
    if (!panel || panel.hidden) unseen += alerts.length; // already looking at the panel: nothing unseen
    renderBell();
  }

  // ---------- browser: panel ----------
  const fmt = (ts) => new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  function renderBell() {
    const b = document.getElementById('bellBtn');
    if (b) b.innerHTML = `🔔 Alerts${unseen ? ` <span class="badge">${unseen}</span>` : ''}`;
  }
  function renderPanel() {
    const p = document.getElementById('alertPanel');
    if (!p || p.hidden) return;
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    p.innerHTML = `
      <div class="ap-h"><b>Alerts</b><button class="ap-close" aria-label="Close">×</button></div>
      <label>Race calls
        <select data-set="calls">
          ${[['off', 'Off'], ['starred', 'Starred races only'], ['senate-gov', 'All Senate & Governor + starred House'], ['all', 'Every race (incl. all House)']].map(([v, l]) => `<option value="${v}"${settings.calls === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="chk"><input type="checkbox" data-set="leads"${settings.leads ? ' checked' : ''}> Lead changes in starred races</label>
      <label class="chk"><input type="checkbox" data-set="swings"${settings.swings ? ' checked' : ''}> Market swings of
        <input type="number" min="3" max="50" data-set="swingPts" value="${settings.swingPts}"> pts within
        <input type="number" min="1" max="120" data-set="swingMin" value="${settings.swingMin}"> min
        <small>(control widgets + starred races)</small></label>
      <label class="chk"><input type="checkbox" data-set="sound"${settings.sound ? ' checked' : ''}> Sound</label>
      <label class="chk"><input type="checkbox" data-set="desktop"${settings.desktop ? ' checked' : ''}${notif === 'unsupported' || notif === 'denied' ? ' disabled' : ''}> Desktop notifications
        <small>${notif === 'denied' ? '(blocked in browser settings)' : notif === 'unsupported' ? '(not supported here)' : notif === 'granted' ? '' : '(browser will ask)'}</small></label>
      <div class="ap-row"><span>${stars.size} starred race${stars.size === 1 ? '' : 's'} · ☆ on any card</span><button data-act="test">Test alert</button></div>
      <div class="ap-log"><b>Recent</b>${log.length ? log.slice(0, 20).map((a, i) => `<div class="ap-item" data-i="${i}"><span class="when">${fmt(a.ts)}</span> ${esc(a.title)}<br><small>${esc(a.body)}</small></div>`).join('') : '<div class="sub">Nothing yet.</div>'}</div>
      <p class="sub">Alerts run in this browser tab: keep it open (it can be in the background).</p>`;
  }
  function wirePanel() {
    const btn = document.getElementById('bellBtn'), p = document.getElementById('alertPanel');
    if (!btn || !p) return;
    btn.onclick = () => { p.hidden = !p.hidden; unseen = 0; renderBell(); renderPanel(); };
    p.addEventListener('change', async (e) => {
      const k = e.target.dataset.set; if (!k) return;
      let v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Math.max(Number(e.target.min), Math.min(Number(e.target.max), Number(e.target.value) || DEFAULTS[k])) : e.target.value;
      if (k === 'desktop' && v && 'Notification' in window && Notification.permission !== 'granted') v = (await Notification.requestPermission()) === 'granted';
      if (k === 'sound' && v) beep(); // also unlocks audio (needs a click)
      settings[k] = v; store.set('alertSettings', settings); renderPanel();
    });
    p.addEventListener('click', (e) => {
      if (e.target.closest('.ap-close')) { p.hidden = true; return; }
      if (e.target.dataset.act === 'test') { deliver([{ kind: 'test', key: null, ts: Date.now(), title: 'Test alert', body: 'Alerts are working in this tab.' }]); renderPanel(); return; }
      const it = e.target.closest('.ap-item'); if (it) jump(log[Number(it.dataset.i)].key);
    });
  }

  // Called after every refresh with the latest server state.
  root.checkAlerts = function (S) {
    const r = detect(detector, S, settings, stars, Date.now(), detector ? null : store.get('lastCallTs', null));
    detector = r.state;
    store.set('lastCallTs', detector.lastCallTs);
    deliver(r.alerts);
    renderPanel();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { wirePanel(); renderBell(); });
  else { wirePanel(); renderBell(); }
})(typeof window !== 'undefined' ? window : globalThis);
