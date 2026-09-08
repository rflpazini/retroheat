# Methodology

How a number on this site is produced, and what it is not.

## 1. What gets tracked

A hand-curated catalog in `catalog/`, one YAML file per platform. Momentum is
only meaningful for titles collectors actually trade, so this is a curated list
rather than every game ever pressed. Print variants that price differently — a
PS2 black label against its Greatest Hits reprint — are separate entries.

## 2. Collecting listings

Each game gets **one** eBay Browse API search per run. The query is the
catalog's `ebay.query` with the entry's `negative` terms appended as
exclusions, restricted to the Video Games category, fixed-price US listings
priced in USD above $3, capped at 200 results.

One call per game is deliberate. Pagination would multiply the daily API budget
for very little accuracy, and the free tier allows 5,000 calls a day.

## 3. Sorting listings by condition

A listing must first name the game. A keyword search also returns storefront
listings ("PS2 Games A–C Disc Only, pick your title") and unrelated items that
never mention it; those are dropped before anything else, since they would be
bucketed by condition and drag a median toward whatever they cost. At least
half of the title's words must appear, and any number in the title always must:
half of "Persona 4" is in "Persona 3 FES", but the number is the whole
difference. Roman numerals, ordinals and spelled-out numbers are treated as
equal, so "Shenmue II", "Shenmue 2" and "3rd Strike" all match.

A number in the listing has to be the game's number. "Dark Cloud (Sony
PlayStation 2)" is not Dark Cloud 2 and "Silent Hill Origins PlayStation 2" is
not Silent Hill 2, so the platform's own name is set aside before the check;
Nintendo 64 is left alone because its games carry the 64 in their titles. A
two-word title needs both words, since half of "Suikoden Tactics" is how "La
Pucelle Tactics" would get counted.

It must also be the release the catalog tracks. Entries are the North American
release unless they say otherwise, so for those a title that says Japan, JPN,
JP, NTSC-J, PAL, European, Korean, Asian, Russian or import is skipped: a
Japanese Mario Kart 64 complete in box asks a quarter of what the US one does,
and counting it is as wrong as counting a different game. "Made in Japan" is
not an import; it is printed on North American cartridges. An entry marked
`region: PAL` keeps its PAL copies and drops the Japanese ones, which are
cheaper and sold with exactly those words; an entry marked `region: NTSC-J`,
for a game that only shipped in Japan, drops PAL copies. The catalog's own
exclusions are matched with apostrophes removed, so "players choice" also
catches "Player's Choice" and the curly "Player’s Choice" that eBay's search
leaves through.

Every surviving title is then read in a fixed order:

1. **Rejected outright** — empty cases, box-only, manual-only, reproductions,
   lots and bundles, multi-game carts, "pick your game" storefront listings,
   consoles, strategy guides, flags and banners, demo, trial and preview
   discs, soundtrack-only and art-book listings, skins and decals, display
   cases and box protectors sold on their own, download codes, graded slabs
   (PSA, CGC, VGA, WATA, "graded"), and anything for parts. One numbered disc
   of a multi-disc set ("Disc 2 only", "missing disc 1") is also rejected,
   unless the title names the other discs. A listing that says "poster" is
   kept: Pokémon XD and Turok 2 shipped with one, and "CIB with poster" is a
   complete copy.
2. **Sealed** — "factory sealed", "brand new", "still sealed", and similar.
   Two tells override it: a sealed copy that was "tested" was opened, and
   "Brand New Factory Sealed US Version" at a third of the complete price is
   the template bootleg sellers use. Both are rejected rather than counted.
3. **Loose, stated explicitly** — "disc only", "cart only", "no manual", "no
   case". An explicit statement of what is missing outranks "complete": a
   seller who writes "Complete Case Disc Only - No Manual" is describing an
   incomplete copy.
4. **Complete in box** — "CIB", "complete in box", "complete with", or the
   parts listed out: "box, manual and cart", "w/ box & manual".
5. **With manual** — "with manual", "w manual", "manual included". On a disc
   platform the disc is in its case, so this is a complete copy. On a
   cartridge platform (N64) the cardboard box is the part collectors pay for,
   so a cartridge "with manual" only counts as complete when the title also
   names the box; otherwise it is dropped, since it is worth more than a bare
   cartridge and much less than a boxed one and belongs in neither bucket.
   "No box" and "box protector" do not name a box. On a disc platform "no
   box" means no case, and is read as loose.
6. **Loose** — "loose", "unboxed".
7. **Bare cartridge or card** — a title that says nothing about completeness
   on a cartridge platform (N64) or a card platform (PS Vita) is a loose copy.
   The box, the case and the manual are where the value is, and a seller who
   has them says so; on 8 September 2026, 90% of N64 listings and 82% of Vita
   listings were bare, and a third of the N64 catalog could not be priced
   without them. Bare disc listings are not read this way: a disc with no
   words is usually the disc in its case, sometimes with the manual, and the
   two markets differ.
8. **Unknown** — dropped.

Unknown listings are dropped rather than guessed. Guessing would bias the
medians, and a smaller honest sample beats a larger invented one. Phrases where
"complete" belongs to the product name, such as *Kingdom Hearts Complete
Edition*, are stripped before the complete-in-box rules run.

The eBay-supplied condition field is ignored. Reproduction cartridges and
merchandise are routinely listed as "New", so a copy only counts as sealed when
the seller says so in the title.

## 4. Reducing a bucket to one price

Retro listings mix a tight cluster of real prices with a few fantasy prices.
Each condition bucket is trimmed with the interquartile rule — values outside
`[Q1 − 1.5 × IQR, Q3 + 1.5 × IQR]` are discarded — and three figures are taken
from what survives:

- **Median**: the middle asking price. This is the headline number, and the one
  history and momentum are computed from.
- **Mode**: the most common price point after rounding each listing to the
  nearest dollar, so $29.99 and $30.00 count as the same point. Where the median
  says what the middle seller asks, the mode says where sellers actually
  cluster. Ties go to the point nearest the median, then to the lower price.
  When no two sellers share a point there is no cluster, and no mode is
  published rather than a single listing dressed up as one.
- **Middle half**: the first and third quartile of the trimmed bucket. A quarter
  of sellers ask less than the low end, a quarter ask more than the high end.
  One median cannot say whether a $279 complete Mario Kart 64 is a fantasy
  price or the top of a wide market; a middle half of $110–$170 can.

The site leads with the complete-in-box figure where one exists and prints the
loose figure beside it, because the two markets differ by a factor of three
for a common cartridge and a reader who has only seen loose copies would
otherwise take the headline for an error.

A bucket needs **at least four** surviving listings to be published at all.

## 5. History

One point per game per day. A second run on the same day replaces that day's
point rather than appending, so the file never grows twice in a day. Points
older than 90 days are compacted to one point per ISO week, holding the median
of that week. A game's full history is therefore a few kilobytes a year.

Each point also records the version of the classification rules that produced
it (`v`; points written before the field existed count as version 0). When the
rules change in a way that moves medians, the version is bumped in the same
commit and the new points start a new series: momentum is never measured across
the change, a week that straddles it is never compacted, and the game page
draws the older points as a dashed tail. Nothing is deleted. A rule change
costs the boards about a week of quiet, the same as the first week of
collection, instead of a history wipe.

## 6. Momentum

- The series is smoothed with a **five-point rolling median**, which removes
  one-day spikes without flattening a real move.
- **7-day** and **30-day** percentage changes are measured against the smoothed
  point closest to that date, within a three-day tolerance, so a missed
  scheduled run does not blank the number.
- The **1-day** change is different on purpose: it compares today's raw point
  with the previous day's raw point, no smoothing, provided that point is at
  most three days old. It is the noisiest figure on the site, because asking
  medians move as listings appear and sell, and it is shown so you can see what
  moved today rather than what has been moving.
- **Score = 0.6 × 7-day + 0.4 × 30-day**, measured on the complete-in-box price
  where one exists, otherwise the loose price. A game with only a 1-day change
  is scored by that change until a week of points exists.
- A board keeps the top entries by score plus the top entries by 1-day change,
  so a game that jumped today is on the board even when its week is flat.

Two gates apply to the trending boards:

- **Price floor of $10.** A few dollars of noise on a bargain-bin title reads
  as a huge percentage.
- **At least four listings** behind the price.

Ranking by percentage rather than dollars is the point. Dollar-sorted movers
lists repeat the same expensive titles every week; percentage surfaces the $40
game becoming a $60 game.

## 7. When a run fails

Games are priced independently. If one fails, its previous figure is kept and
flagged `stale` rather than dropped, so a board never develops holes. If fewer
than half the tracked games price successfully, the run exits non-zero so the
workflow fails loudly instead of publishing a half-empty board.

## 8. Known limits

- **Asking, not sold.** The single most important caveat. See the README.
- US listings in USD only.
- Thinly listed games are noisy; the four-listing gate helps but does not
  eliminate this.
- Graded copies, promo and demo discs, regional imports and hardware are out of
  scope.
- Annotations are hand-written by contributors and are editorial, not data.

## 9. Never losing collected data

The history is the one thing the project cannot re-download. Four things keep
a rule change, a bad merge or an overlapping run from ever costing it again.

**Series versions.** Every point carries the classifier version that produced
it (§5). `classify.SeriesVersion` is bumped in the same commit as any change to
the classifier, to the eBay listing filters, or to the aggregation that can
move a published median; per-game catalog edits and refactors that leave every
classification identical do not bump it. Momentum is measured only within the
newest version, so the first run after a bump shows no moves and the boards
stay quiet for up to a week, as in the first week of collection. `meta.json`
carries `series_version` so a bump can be confirmed on the live site.

**The raw archive.** Each scheduled run writes one compressed file holding
every listing it saw, per game, before judging any of it: item id, title,
price and currency, plus the query and, for games that failed, the error. At
about 400 KB per run the files are published as assets of a monthly
prerelease named `raw-YYYY-MM` rather than committed. The format (`schema` 1):

```json
{"schema":1,"generated_at":"2026-09-07T09:23:41Z","source":"ebay-browse","series_version":1,
 "games":[{"id":"ogre-battle-64-n64","q":"Ogre Battle 64 N64 -...","err":"",
           "listings":[{"i":"v1|123|0","t":"Ogre Battle 64 (Nintendo 64) ...","p":2499,"c":"USD"}]}]}
```

**Replay.** After a rule change, rebuild history under the new rules with zero
API calls:

```bash
gh release download raw-2026-09 -D raw --pattern 'raw-*.json.gz'
go run ./cmd/replay -archive ./raw -data ./data -catalog ./catalog -dry-run
go run ./cmd/replay -archive ./raw -data ./data -catalog ./catalog
```

Replay judges the archived listings with the current rules and the current
catalog entry, replaces the points for the days it covers, stamped with the
current version, and leaves every other point alone; the next scheduled run
rebuilds the boards. Two limits: it cannot recover listings a different search
query would have returned, and once weeks have been compacted a range should
be replayed whole, because a week is folded again from whatever days were
replayed. A day the archive cannot price is left as it was and counted,
because the archive does not cover every run that ever wrote a point;
`-prune` removes such days instead, and that removal is the one change the
data guard refuses without a trailer.

**The data guard.** `cmd/dataguard` compares the data directory between two
commits and fails when a history file, a point, a board, or a game still in
the catalog has disappeared. A daily point may vanish only into its week's
compacted point; a same-date value change, which twice-daily runs produce, is
allowed. CI runs it on every push and pull request; the scrape job runs it on
its own output before committing and has no way around it. A deliberate reset
carries a `Data-Reset: <reason>` trailer in the commit message, so it is
visible in `git log` forever.

**The Supabase copy.** When the scheduled run holds the project's service
role key, it also writes each run's points to a `price_points` table and the
run's summary to `collector_runs`, so the history exists somewhere other than
this repository and can be read as a timeline per game. The anon key the site
ships with may only read those tables. `go run ./cmd/mirror` makes the copy
match the files exactly, adding, replacing and removing points as needed: it
is the one-time backfill, the weekly resync the scheduled run performs (a
rollup removes dailies the per-run push never sees), and the step after a
replay. `go run ./cmd/mirror -pull` rebuilds `data/history` from the copy byte
for byte.

**Restoring.** Git history is the first-tier backup, the archive the second
and the Supabase copy the third. To restore from git: find the last good data
commit with `git log --oneline -- data/history`, then
`git checkout <sha> -- data/history data/latest data/trending`, run the
collector once, and commit. To restore from Supabase:
`go run ./cmd/mirror -pull`, then the same collector run and commit. Either
commit only adds points, so it passes the guard without a trailer.
