# RetroHeat

A daily momentum board for collectible retro games. It tracks a curated list of
PlayStation 2, GameCube, PSP, PS Vita, Nintendo 64 and Dreamcast titles, and
ranks them by how fast their prices are moving — plus, where a contributor has
written one, a note explaining *why*.

Every price site worth using either paywalls its movers list, sorts it by dollar
change so the same expensive games appear every week, or never says what drove a
move. RetroHeat is free, ranks by percentage, and shows its work.

**Stack:** a Go collector that commits JSON to this repository, and a React site
on GitHub Pages that reads it. No server, no database, no hosting bill.

## What the numbers mean

Prices are the **median asking price of active eBay listings**, not realized
sale prices. eBay retired public access to sold-listing data (the Finding API
was decommissioned in February 2025, and Marketplace Insights is closed to new
applications), so no free source of true sale prices exists.

Asking prices sit above sale prices. The direction they move is meaningful; the
absolute number is not an appraisal. The site says so on every page, and
`METHODOLOGY.md` explains exactly how a figure is produced.

## Run it with Docker

Nothing to install but Docker:

```bash
docker compose up --build
```

That generates sample data, then serves the site on
**http://localhost:8080**. The collector runs once and exits; the web container
serves its output from `./data`, which is the same directory the scheduled
workflow commits.

```bash
docker compose down                 # stop
docker compose run --rm collector   # regenerate the data only
docker compose build                # after changing Go code, rebuild BOTH images
```

`docker compose up` starts the collector before the site, and the collector
rewrites `./data`. After changing anything in the Go pipeline, rebuild both
images — `docker compose build web` alone leaves a stale collector that will
quietly overwrite your data with the old shape.

Once you have eBay credentials, swap the sample data for real prices:

```bash
cp .env.example .env         # then fill in the two keys
docker compose --profile live run --rm collector-live
docker compose up web
```

## Run it without Docker

```bash
# Generate deterministic sample data — no API credentials needed.
go run ./cmd/collector -fake -data ./data -catalog ./catalog

# Serve the site against it.
cd web && npm ci && npm run dev
```

The dev server serves `data/` at `/data`, the same path the deployed site uses.

### Running against real prices

You need a free eBay developer account. The Browse API this project uses is
reached with an application token, so there is no user login to implement.

1. Register at [developer.ebay.com](https://developer.ebay.com/). New accounts
   are reviewed before they are usable — expect roughly one business day.
2. Once approved, open
   [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys) and create a
   **Production** keyset (the Sandbox keyset returns test listings, not real
   prices, so it is not useful here).
3. eBay will not release a production keyset until you either subscribe to or
   opt out of **marketplace account deletion notifications**. There is a link on
   the keys page; opting out is fine for a read-only project like this one.
4. From that keyset, take **App ID (Client ID)** and **Cert ID (Client Secret)**.
   Dev ID is not needed.

```bash
export EBAY_CLIENT_ID=...      # App ID
export EBAY_CLIENT_SECRET=...  # Cert ID
go run ./cmd/collector -platforms ps2 -data ./data -catalog ./catalog
```

Start with one platform and `-audit` to see how real listings are being
classified before running the whole catalog. The free tier allows 5,000 calls a
day and the collector spends one per game.

Useful flags:

| Flag | Purpose |
| --- | --- |
| `-fake` | Deterministic sample data, no network |
| `-platforms ps2,n64` | Collect a subset |
| `-audit` | Print how each live listing was classified, then exit |
| `-budget 2000` | Cap API calls for the run (0 = unlimited) |
| `-v` | Debug logging |

`-audit` is the tool for tuning a catalog entry whose search is pulling in the
wrong sequel or a pile of empty cases.

## What runs on GitHub Actions

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci` | push, pull request | Go build, vet, race tests, lint, govulncheck; web typecheck, tests, build |
| `scrape` | cron `23 9,21 * * *`, manual | Prices the catalog, commits changed data, asks `deploy` to run |
| `deploy` | push to `web/**` or `data/**`, manual | Builds the site and publishes it to Pages |
| `keepalive` | cron weekly | Re-enables scheduled workflows if GitHub disables them after 60 quiet days |

The cron runs at an odd minute on purpose: GitHub's scheduler is best-effort
and jobs queued on the hour are the ones most often delayed or dropped.

## How it stays free

A scheduled workflow runs the collector twice a day and commits the JSON it
produces; a second workflow rebuilds the site. Public repositories get unlimited
GitHub Actions minutes, and the free eBay tier allows 5,000 calls a day against
a catalog of a few hundred games.

The daily data commit doubles as repository activity, which is what keeps
GitHub from disabling the schedule after 60 days of quiet.

## Deploying your own

1. Fork the repository.
2. Add repository secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`.
3. Settings → Pages → Source: **GitHub Actions**.
4. Settings → Actions → Workflow permissions: **Read and write**.
5. Run the `scrape` workflow manually once, then let the schedule take over.

Until those secrets exist the scheduled run does not fail — it checks for
credentials first, writes a summary saying which secrets are missing, and stops
without touching the data. Adding the secrets is the only thing needed to start
collecting; the workflow needs no edit.

The scrape job pushes its data commit straight to the default branch. GitHub
Actions bots are not exempt from branch protection, so if you protect that
branch — required reviews, required status checks, or a push allow-list — the
push is rejected on every run. Either leave the branch unprotected, add the
workflow to the allow-list, or change the job to open a pull request instead.

## Using PriceCharting instead

The collector has a `PriceProvider` seam, and a PriceCharting adapter ships with
it. It activates when `PRICECHARTING_TOKEN` is set.

**Read their terms before you turn it on.** PriceCharting's terms state that
their price data "cannot be used in any software, application, or system that is
accessible to third parties … without express written permission," with a
carve-out only for referencing prices with clear citation and a link back.
Publishing their data on a public site needs their written permission first, and
their data should never be committed to a public repository without it. That is
why eBay is the default.

## Contributing

Adding a game, or explaining why one is moving, is a one-file pull request. See
`CONTRIBUTING.md` and `catalog/SCHEMA.md`.

## Licence

MIT. Not affiliated with eBay, PriceCharting, Sony, Nintendo, Sega, or any
publisher named in the catalog.
