# Election Night Desk

A single-screen dashboard for U.S. election day and night (Nov 3, 2026). It shows:

| Panel | Source | Refresh |
|---|---|---|
| Balance of power (Senate / House / Governors) | Calculated from the race calls below plus the Senate seats not on the ballot | 30 s |
| Race-by-race vote tallies, % of expected vote in, winners | **Associated Press Elections API**, the feed most major newsrooms use for counts and calls | 30 s |
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

Without `AP_API_KEY`, markets and news still work and the results panel shows a notice instead of tallies.

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
