'use strict';
// Election-morning check: fetch every configured state feed once and print what was parsed.
//   node tools/check-states.js          (all states)
//   node tools/check-states.js GA MN    (just these)
const cfg = require('../config.json');
const { StateFeedsProvider } = require('../lib/statefeeds');

(async () => {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  if (only.length) cfg.results.stateFeeds = Object.fromEntries(Object.entries(cfg.results.stateFeeds).filter(([k]) => only.includes(k)));
  const p = new StateFeedsProvider(cfg);
  const races = await p.fetch();
  for (const f of p.feedStatus()) {
    console.log(`\n${f.ok ? 'OK ' : f.info ? '-- ' : 'ERR'} ${f.state}  ${f.message}\n    ${f.url || ''}`);
    for (const r of races.filter((x) => x.state === f.state)) {
      console.log(`    ${r.title}  [${r.reportingLabel || (r.eevp != null ? r.eevp.toFixed(1) + '%' : 'no reporting info')}]`);
      for (const c of r.candidates.slice(0, 5)) console.log(`      ${c.name.padEnd(32)} ${c.party.padEnd(4)} ${String(c.votes).padStart(10)}  ${c.pct.toFixed(1)}%`);
    }
  }
  console.log('');
})();
