# Election Night Desk

A single-screen dashboard for U.S. election night (Nov 3, 2026): Senate, House and governors. It shows:

| Panel | Source | Refresh |
|---|---|---|
| Balance of power: Senate, House, Governors | Races **called per civicAPI** (solid; plus Senate seats not up) and races where a party **leads the count** (light) | 30 s |
| Senate vote counts in 9 states | **Official state election websites** (NC, GA, MI, OH, TX, IA, AK, MN, FL). Unofficial counts | 30–60 s per state |
| All other Senate races, all 36 governor races, all 435 House races | **[civicAPI (civicapi.org)](https://civicapi.org)**, free and keyless | about 1 request/s, spread across races |
| Race calls (✓ and the calls log) | civicAPI's winner flags, labelled "called per civicAPI" | with the above |
| Prediction markets: one widget per question **and election year** (Senate control · 2026, House control · 2028, …), averaging Kalshi, Polymarket and PredictIt, with a row per platform | **Kalshi**, **Polymarket**, **PredictIt** public price APIs | 60 s |
| Race map at the top of each Races tab, shaded by market odds (Solid/Likely/Lean D, Toss-up, Lean/Likely/Solid R). Senate and Governor: state map. House: tile map, one square per district. Hover for odds; click a state to filter the cards | Same race-market data as below; state outlines from us-atlas (Census) | live |
| Market odds on each race card (below the tally) | Kalshi race markets (`SENATETX-26`, `GOVPARTYTX-26`, `HOUSECA22-26`) and Polymarket's "midterms" tag | Polymarket ~3 min, Kalshi ~4 min |
| Headlines, including race calls by news organizations | RSS from NPR, NYT, Washington Post, Politico, PBS, CBS, ABC, Fox, BBC, The Hill | 2 min |
| Poll-closing timeline and countdown | Static schedule in `public/polls.js` | live |

Everything is free; no API keys. Zero dependencies; you only need **Node 18 or newer**.

**About civicAPI.** It's a small independent project, not a news organization or election office. Its numbers and calls are labelled on every card, and official state counts take precedence where we have them. One pre-election sample listed the SC Republican Senate nominee as "Darline Graham", so expect occasional data errors and check important calls against the news panel. Its licence requires attribution: the page credits "civicAPI (civicapi.org)" with a link. Keep that if you change the layout. To hide its calls, set `civicapi.useWinnerFlags` to `false`; to turn it off entirely, set `civicapi.enabled` to `false`.

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
4. Open "Results sources" in the Races panel. The civicAPI line should say about 72 races loaded within a couple of minutes of startup. Races civicAPI hasn't listed yet are searched again every 10 minutes.

## Design notes

* Your browser only talks to the local server. The server polls every source on a timer and caches the results, so opening the page on several screens doesn't multiply requests, and CORS isn't an issue.
* Sources fail independently. A broken state feed, RSS feed or market shows an error line in its own panel, keeps its last good data, and nothing else breaks. Header dots show each source's freshness.
* Market sparklines and "since start" deltas come from history the server records while it runs. Start it early in the day.
* Markets are grouped by `markets.groups` in `config.json`: a market joins a widget when its title matches and its outcomes are the two parties. Prices are renormalised over Dem + GOP, and the headline figure is the simple average across platforms. Single-state races and combined outcomes ("D House, R Senate") keep their own cards.
* A market's election year comes from its title, ticker or slug, or failing that its close date (control markets close in the following odd year). Each year gets its own widget, so 2026 and 2028 never mix.
* Race-card odds: Polymarket is one paged sweep of its "midterms" tag. Kalshi race events are fetched 10 per request. If Kalshi won't batch, it falls back to one request per race for Senate and governor only, and skips the House. Every Kalshi request goes through one shared throttle (2 s apart; chamber-control requests go first), and a 429 pauses all Kalshi traffic for at least 2 minutes. If Kalshi keeps rate-limiting, set `markets.raceMarkets.kalshiHouse` to `"none"` or `kalshi` to `false`.
* Map shading: for each race, the Democratic share of the Dem + GOP price, averaged across Kalshi and Polymarket, in seven bins (≥85, 65–85, 55–65, 45–55 …). Hatched = there's a market, but it lists candidates without parties (e.g. California's top-two) or none was found. Purple = a non-major-party candidate is favoured. There's no geographic House map because several states redrew districts for 2026 and current boundaries aren't reliably available. `public/us-states.json` comes from us-atlas (see `public/NOTICE-us-atlas.txt`).
* Market prices are probabilities implied by trading, not results. "Leading" in the balance bars is a count lead, not a projection.
* Senate merge rule: a state's official count is shown while its feed works. If civicAPI has called that race, the call is added to the official card (matched by party). If a state feed fails, civicAPI's numbers replace it until the feed recovers.
* civicAPI polling is polite: about one request per second, with the House (one request covering all 435 districts) in every fourth slot. Unchanged races are cheap (ETag), and a rate limit pauses all civicAPI requests for at least 2 minutes or as long as it asks. Calls that already existed when the server started aren't logged as new.
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
