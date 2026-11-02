# Election Night Desk

A single-screen dashboard for U.S. election night (Nov 3, 2026), focused on the Senate. It shows:

| Panel | Source | Refresh |
|---|---|---|
| Senate balance | Seats not up in 2026, plus who **leads the count** in each tracked race (not called) | 30 s |
| Senate vote counts for the watch-list states | **Official state election websites**. Unofficial counts; states don't call races | 30–60 s per state |
| Prediction markets | **Kalshi**, **Polymarket**, **PredictIt** public price APIs | 60 s |
| Headlines, including race calls by news organizations | RSS from NPR, NYT, Washington Post, Politico, PBS, CBS, ABC, Fox, BBC, The Hill | 2 min |
| Poll-closing timeline and countdown | Static schedule in `public/polls.js` | live |

Everything is free; no API keys. Zero dependencies; you only need **Node 18 or newer**.

**What it doesn't do:** call races, or cover House and governor races. For calls, watch the news panel. Outlets report AP and Decision Desk calls within minutes.

## Run it

```bash
npm run demo           # fake data to see the layout; a red DEMO banner is shown
npm start              # the real thing, at http://localhost:8080
npm test               # offline parser checks
npm run check-states   # fetch every state feed once and print what it parsed
```

Set `DASHBOARD_PASSWORD` to require a password (any username works).

## Before election day: checklist

1. **Confirm market IDs** (`npm run find-markets -- senate`) and paste the slugs and tickers into `config.json`. Any that don't resolve show a yellow error on the dashboard, and the other markets keep working.
2. **Verify `senateHoldovers`** in `config.json` (seats not up in 2026: 34 D incl. independents, 31 R) and the poll-closing times in `public/polls.js`.
3. **Election morning:** run `npm run check-states`. Every polled state should load, with zero votes before polls close.

## Design notes

* Your browser only talks to the local server. The server polls every source on a timer and caches the results, so opening the page on several screens doesn't multiply requests, and CORS isn't an issue.
* Sources fail independently. A broken state feed, RSS feed or market shows an error line in its own panel, keeps its last good data, and nothing else breaks. Header dots show each source's freshness.
* Market sparklines and "since start" deltas come from history the server records while it runs. Start it early in the day.
* Market prices are probabilities implied by trading, not results. "Leading" in the Senate bar is a count lead, not a projection.
* Headlines link out to the publishers. Only the titles are shown.

## State results: details

`lib/states/<st>.js` reads each state's own election-night data for the Senate race. These are **unofficial counts, with no race calls**. The card for each race names its source, and the "State results feeds" line in the Races panel shows which feeds are working.

| State | Source | What it shows |
|---|---|---|
| NC | NC State Board of Elections (`er.ncsbe.gov/enr/20261103/data/results_0.txt`) | Statewide totals, precincts reporting |
| GA | GA Secretary of State, Enhanced Voting export | Totals; precincts summed from counties. The election id is found automatically once GA publishes it. The file is about 30 MB, so it's polled every 60 s |
| MI | Michigan Bureau of Elections county file (`mielections.us/.../2026GEN_MI_CENR_BY_COUNTY.xls`) | County rows summed; **no reporting %**. The URL is inferred from 2020/2022, so confirm it on the night |
| OH | Ohio SOS live results JSON | Special election; county rows summed. Rate-limited, so polled every 60 s |
| TX | Texas SOS Civix ENR (election 53815) | Totals, polling places reporting |
| IA | Iowa SOS on Clarity ENR (election 127077) | Totals, counties fully reported |
| AK | Alaska Division of Elections precinct CSV (`/enr26/`) | **First-choice votes only**; ranked-choice rounds come about two weeks later. In late October this file still held the primary; confirm it switches over |
| MN | Minnesota SOS media file `ussenate.txt` | Statewide totals, precincts reporting |
| FL | Florida Division of Elections election-night file | Special election; counties summed |
| ME, NH | none | These states publish no live statewide results. Follow the news panel |
| NE | not polled | The state portal's policy reportedly bars automated access without written permission |

**Election morning:** run `npm run check-states`. It fetches every feed once and prints what it parsed. Before polls close, most feeds will show zero votes; that's expected. Formats and URLs come from the states' 2026 pre-election files and earlier elections, captured by open-source scrapers. They were not tested against the live sites from where this was built, and states sometimes change things on the night. If one breaks, it shows a yellow message, the rest keep working, and the last good numbers stay on screen.

**Terms of use:** these are public government sites, but check each state's terms and be gentle. The polling intervals above are deliberately modest. Michigan's state web terms reportedly restrict automated access; disable it (`"enabled": false`) if that concerns you.

**Alaska certificate:** Alaska's server has been reported to send an incomplete TLS certificate chain. If `check-states` shows a certificate error for AK, download the missing intermediate certificate (GlobalSign, named in the browser's certificate viewer for elections.alaska.gov) and start the server with `NODE_EXTRA_CA_CERTS=/path/to/intermediate.pem`. Never turn off TLS verification.

`npm test` runs the parsers against real files saved from the state sites, in `test/fixtures/`.

## Hosting on Render

1. In Render, choose **New → Blueprint**, pick this repository and apply. It reads `render.yaml`.
2. When prompted, set **`DASHBOARD_PASSWORD`**.
3. Render gives you a URL like `https://election-night-desk.onrender.com`. Pushes to `main` redeploy automatically.
4. Election morning: open the service's **Shell** tab and run `npm run check-states`.

To preview with fake data, add the env var `DEMO=1` temporarily. Remove it before polls close.
