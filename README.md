# RetroHeat

A daily momentum board for collectible retro games. It tracks a curated list of
PlayStation 2, GameCube, PSP, PS Vita, Nintendo 64 and Dreamcast titles, and
ranks them by how fast their prices are moving — plus, where a contributor has
written one, a note explaining *why*.

Every price site worth using either paywalls its movers list, sorts it by dollar
change so the same expensive games appear every week, or never says what drove a
move. RetroHeat is free, ranks by percentage, and shows its work.

**Stack:** a Go collector that commits JSON to this repository, and a React site
on GitHub Pages that reads it. No server of its own and no hosting bill. The
optional sign-in for saved games and collections runs on Supabase's free tier,
and the site works without it.

## What the numbers mean

Prices are the **median asking price of active eBay listings**, shown alongside
the **mode** (the whole-dollar price point most sellers cluster on) and the
**middle half** (the range a quarter of sellers ask below and a quarter above),
not realized sale prices. Each game carries a figure per condition: a complete
Mario Kart 64 with box and manual and a bare cartridge are different markets,
and the site shows both rather than one number. eBay retired public access to sold-listing data (the Finding API
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

While a Production keyset is still pending, a Sandbox keyset plus
`EBAY_BASE_URL=https://api.sandbox.ebay.com` runs the same pipeline against
eBay's test listings. That proves the wiring, not the prices: sandbox data is
synthetic and must not be committed.

Useful flags:

| Flag | Purpose |
| --- | --- |
| `-fake` | Deterministic sample data, no network |
| `-platforms ps2,n64` | Collect a subset |
| `-audit` | Print how each live listing was classified, then exit |
| `-budget 2000` | Cap API calls for the run (0 = unlimited) |
| `-catalog-only` | Rewrite `catalog.json` from the YAML without pricing; for editorial edits |
| `-raw-dir ./raw` | Also write one compressed file with every listing the run saw, for `cmd/replay` |
| `-v` | Debug logging |

`-audit` is the tool for tuning a catalog entry whose search is pulling in the
wrong sequel or a pile of empty cases.

## Accounts

Sign-in is optional and exists for two things: a list of saved games, and a
collection of what you own, with the condition of each copy and a shelf value
that adds up today's asking prices. It runs on [Supabase](https://supabase.com)
and is hidden entirely when the site is built without it.

- **Sign in with Google or an email link.** No passwords. The email link has to
  be opened in the same browser that requested it.
- **What is stored:** your account id, your email address (and the name and
  picture Google shares), the ids of the games you save, and one condition per
  owned game, with timestamps. Nothing else: no browsing history, no analytics.
- **Who can see it:** only you. Row-level security in the database scopes every
  row to its owner; the site talks to the database with a public key, and that
  boundary is the database's, not the browser's.
- **Delete it any time** from the account menu. That removes the account and
  everything saved with it.

## What runs on GitHub Actions

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci` | push, pull request | Go build, vet, race tests, lint, govulncheck; web typecheck, tests, build; `data-guard` refuses any loss of collected data |
| `scrape` | cron `23 9,21 * * *`, manual | Prices the catalog, uploads the raw listings to a monthly release, commits changed data (after the same guard), asks `deploy` to run |
| `deploy` | push to `web/**` or `data/**`, manual | Builds the site and publishes it to Pages |
| `keepalive` | cron twice weekly | Re-enables scheduled workflows if GitHub disables them after 60 quiet days; pings Supabase so a free project is not paused |

The cron runs at an odd minute on purpose: GitHub's scheduler is best-effort
and jobs queued on the hour are the ones most often delayed or dropped.

## How it stays free

A scheduled workflow runs the collector twice a day and commits the JSON it
produces; a second workflow rebuilds the site. Public repositories get unlimited
GitHub Actions minutes, and the free eBay tier allows 5,000 calls a day against
a catalog of a few hundred games.

The daily data commit doubles as repository activity, which is what keeps
GitHub from disabling the schedule after 60 days of quiet. The raw listing
archives go to release assets, which cost nothing either.

Accounts, when enabled, use Supabase's free tier: hosted sign-in and a Postgres
database with limits far above what a site this size needs. A free project is
paused after a week without traffic, so the keepalive workflow sends it one
query twice a week.

## Recovering data

The price history is the one thing that cannot be re-downloaded, so nothing is
allowed to delete it quietly. Every point records the classifier version that
produced it, and a rule change starts a new series instead of a wipe. Every
run's raw listings are archived, so `cmd/replay` can rebuild history under new
rules with no API calls. `cmd/dataguard` compares the data tree before and
after every push and pull request, and before every data commit the scrape job
makes, and fails when a file, a point, or a tracked game has vanished; a
deliberate reset needs a `Data-Reset: <reason>` trailer in the commit message.

Git history is the first-tier backup. When the scheduled run holds a Supabase
service role key, every point is also written to the project's `price_points`
table, and `go run ./cmd/mirror -pull` rebuilds `data/history` from it. To
restore from git:

```bash
git log --oneline -- data/history | head                      # find the last good data commit
git checkout <sha> -- data/history data/latest data/trending
go run ./cmd/collector -data ./data -catalog ./catalog        # or wait for the next scheduled run
git commit -m "data: restore from <sha>"                      # adds points only, so the guard passes
```

The rules, the archive format and the replay command are in
[METHODOLOGY.md](METHODOLOGY.md#9-never-losing-collected-data).

## Deploying your own

1. Fork the repository.
2. Add repository secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`.
3. Settings → Pages → Source: **GitHub Actions**.
4. Settings → Actions → Workflow permissions: **Read and write**.
5. Run the `scrape` workflow manually once, then let the schedule take over.
6. Optional, for accounts: create a free [Supabase](https://supabase.com)
   project; run `supabase/migrations/0001_lists.sql` in its SQL editor; under
   Authentication enable Google (an OAuth client in Google Cloud pointing at
   the project's callback URL) and email, and add your site URL to the
   redirect allow-list; set up custom SMTP before real users, since the
   built-in sender is for development only; then add repository
   **Variables** (not secrets, both are public) `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. Skip this and the site simply has no accounts.

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

## Using the look in your own app

The desktop chrome is published as a [shadcn](https://ui.shadcn.com) registry,
so any React project with Tailwind v4 and shadcn set up can install it:

```bash
# the palette, fonts and chrome utilities (window, bevel, stripe, crt, pixel…)
npx shadcn@latest add https://rflpazini.com/retroheat/r/retro-os.json

# individual components; each pulls the theme in with it
npx shadcn@latest add https://rflpazini.com/retroheat/r/window.json
npx shadcn@latest add https://rflpazini.com/retroheat/r/menu-bar.json
npx shadcn@latest add https://rflpazini.com/retroheat/r/spotlight.json

# or everything at once
npx shadcn@latest add https://rflpazini.com/retroheat/r/retro-os-kit.json
```

| Item | What you get |
| --- | --- |
| `retro-os` | Light and night palettes, `--font-pixel`, and utilities: `window`, `window-title`, `title-box`, `stripe`, `bevel`, `bevel-in`, `press`, `pixel`, `eyebrow`, `tabular`, `crt`, `animate-window`, `blink`. |
| `window` | `Window` and `TitleBar`: pinstriped title bar, close and zoom boxes, stepped zoom-open. |
| `menu-bar` | `MenuBar` with an apple menu, real dropdown menus with shortcuts, and `MenuBarClock`. |
| `boot-screen` | A once-per-session startup splash with a stepped progress bar. |
| `crt-screen` | A picture behind CRT glass, or your own text in green phosphor. |
| `status-bar` | The bottom status strip with bevelled wells. |
| `spotlight` | A Cmd+K palette: `Spotlight`, `useSpotlightShortcut`, `shortcutLabel`, `rankItems`. |

Components land in `components/retro-os/`. The theme adds `IBM Plex Mono` and
`Press Start 2P` as font variables but does not load them; add the Google Fonts
link the installer prints to your HTML head. If your project already sets
`--font-sans`, keep it or switch it to `var(--font-mono)` for the full look.

The registry is generated from the site's own stylesheet: `web/src/index.css`
is the source, `npm run registry` refreshes `web/registry.json` from it and
builds the JSON into `web/public/r/`, and a test fails when the two disagree.
The site itself is built from the same components it publishes.

## Contributing

Adding a game, or explaining why one is moving, is a one-file pull request. See
`CONTRIBUTING.md` and `catalog/SCHEMA.md`.

## Licence

MIT. Not affiliated with eBay, PriceCharting, Sony, Nintendo, Sega, or any
publisher named in the catalog.
