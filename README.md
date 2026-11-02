# Election Night Desk

A single-screen dashboard for U.S. election day and night (Nov 3, 2026). It shows:

| Panel | Source | Refresh |
|---|---|---|
| Balance of power (Senate / House / Governors) | Calculated from the race calls below plus the Senate seats not on the ballot | 30 s |
| Race-by-race vote tallies, % of expected vote in, winners | **Associated Press Elections API**, the feed most major newsrooms use for counts and calls (paid) | 30 s |
| Senate vote counts for the watch-list states, free | **Official state election websites** (no race calls) | 30–60 s per state |
| Race-call log | Calls as they first appear in the AP feed | 30 s |
| Prediction markets | **Kalshi**, **Polymarket**, **PredictIt** public price APIs | 60 s |
| Headlines | RSS from NPR, NYT, Washington Post, Politico, PBS, CBS, ABC, Fox, BBC, The Hill | 2 min |
| Poll-closing timeline and countdown | Static schedule in `public/polls.js` | live |

Zero dependencies. You only need **Node 18 or newer**.

## Run it

```bash
npm run demo        # fake data, just to see the layout; a red DEMO banner is shown
AP_API_KEY=xxxx npm start     # the real thing, at http://localhost:8080
npm test            # offline parser checks
```

Without `AP_API_KEY`, the Senate watch-list states still show official state counts, but nothing gets called and the House and governor panels stay empty.

## Before election day: checklist

1. **Get vote-tally access.** The AP Elections API is a paid, licensed product (developer.ap.org; contact AP sales). It's the reputable source with national coverage and race calls. Ask about a test key; AP runs test feeds before the election. Mention the "nextrequest" incremental mode: this app uses it, so it makes a small request every 30 s rather than re-downloading everything.
   *Alternatives:* Decision Desk HQ also licenses an API. A new provider is one class in `lib/results.js` that returns the same race shape.
2. **Confirm market IDs** (`node tools/find-markets.js house`, `... senate`, `... "georgia senate"`) and paste slugs/tickers into `config.json`. The ones there now are best guesses. Any that don't resolve show a yellow error on the dashboard, and the other markets keep working.
3. **Edit the watch list** in `config.json` (`results.watchStates`). For House races, use codes like `"PA-07"`. Leave it empty to show the closest uncalled House races.
4. **Verify `senateHoldovers`** (seats not up in 2026; currently 34 D incl. independents, 31 R) and the poll-closing times in `public/polls.js` against state election offices.
5. **Do a dry run** with the AP test feed a few days before.

## Design notes

* Your browser only talks to the local server. The server polls every source on a timer and caches the results, so opening the page on several screens doesn't multiply API calls, and CORS isn't an issue.
* Sources fail independently: a dead RSS feed or market API shows an error line in its own panel and nothing else breaks. Header dots show each source's freshness.
* Market sparklines and "since start" deltas come from history the server records while it runs. Start it early in the day.
* Prices are probabilities implied by trading, not results. The UI labels them that way.
* Headlines link out to the publishers. Only the titles are shown.

## Optional extras

* Host it for a group: any small VM, Fly.io or Render. Set `AP_API_KEY` as a secret, and keep the AP license terms in mind before you show their data publicly.
* Add official state results pages (e.g. a state's own results JSON) as extra providers for specific races.
* Add desktop notifications when a watch-list race is called.

## Hosting on Render

1. In Render, choose **New → Blueprint**, pick this repository and apply. It reads `render.yaml`.
2. When prompted, set **`DASHBOARD_PASSWORD`**. Visitors log in with any username plus this password. Set **`AP_API_KEY`** once you have it; until then, results show a notice.
3. Render gives you a URL like `https://election-night-desk.onrender.com`. Pushes to `main` redeploy automatically.

To preview without real results, add the env var `DEMO=1` temporarily. Remove it before election day.

## Free state results (no AP key)

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
| ME, NH | none | These states publish no live statewide results. Use AP or the news panel |
| NE | not polled | The state portal's policy reportedly bars automated access without written permission |

**Election morning:** run `npm run check-states`. It fetches every feed once and prints what it parsed. Before polls close, most feeds will show zero votes; that's expected. Formats and URLs come from the states' 2026 pre-election files and earlier elections, captured by open-source scrapers. They were not tested against the live sites from where this was built, and states sometimes change things on the night. If one breaks, it shows a yellow message, the rest keep working, and the last good numbers stay on screen.

**Terms of use:** these are public government sites, but check each state's terms and be gentle. The polling intervals above are deliberately modest. Michigan's state web terms reportedly restrict automated access; disable it (`"enabled": false`) if that concerns you.

**Alaska certificate:** Alaska's server has been reported to send an incomplete TLS certificate chain. If `check-states` shows a certificate error for AK, download the missing intermediate certificate (GlobalSign, named in the browser's certificate viewer for elections.alaska.gov) and start the server with `NODE_EXTRA_CA_CERTS=/path/to/intermediate.pem`. Never turn off TLS verification.

`npm test` runs the parsers against real files saved from the state sites, in `test/fixtures/`.
