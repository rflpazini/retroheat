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

Every surviving title is then read in a fixed order:

1. **Rejected outright** — empty cases, box-only, manual-only, reproductions,
   lots and bundles, consoles, strategy guides, posters, demo discs, download
   codes, graded slabs, and anything for parts.
2. **Sealed** — "factory sealed", "brand new", "still sealed", and similar.
3. **Loose, stated explicitly** — "disc only", "cart only", "no manual", "no
   case". An explicit statement of what is missing outranks "complete": a
   seller who writes "Complete Case Disc Only - No Manual" is describing an
   incomplete copy.
4. **Complete in box** — "CIB", "complete in box", "with manual", "w manual".
5. **Loose** — "loose", "unboxed".
6. **Unknown** — dropped.

Unknown listings are dropped rather than guessed. Guessing would bias the
medians, and a smaller honest sample beats a larger invented one. Phrases where
"complete" belongs to the product name, such as *Kingdom Hearts Complete
Edition*, are stripped before the complete-in-box rules run.

The eBay-supplied condition field is used only as a tiebreak, and only to
recognise a new copy.

## 4. Reducing a bucket to one price

Retro listings mix a tight cluster of real prices with a few fantasy prices.
Each condition bucket is trimmed with the interquartile rule — values outside
`[Q1 − 1.5 × IQR, Q3 + 1.5 × IQR]` are discarded — and two figures are taken
from what survives:

- **Median**: the middle asking price. This is the headline number, and the one
  history and momentum are computed from.
- **Mode**: the most common price point after rounding each listing to the
  nearest dollar, so $29.99 and $30.00 count as the same point. Where the median
  says what the middle seller asks, the mode says where sellers actually
  cluster. Ties go to the point nearest the median, then to the lower price.

A bucket needs **at least four** surviving listings to be published at all.

## 5. History

One point per game per day. A second run on the same day replaces that day's
point rather than appending, so the file never grows twice in a day. Points
older than 90 days are compacted to one point per ISO week, holding the median
of that week. A game's full history is therefore a few kilobytes a year.

## 6. Momentum

- The series is smoothed with a **five-point rolling median**, which removes
  one-day spikes without flattening a real move.
- **7-day** and **30-day** percentage changes are measured against the smoothed
  point closest to that date, within a three-day tolerance, so a missed
  scheduled run does not blank the number.
- **Score = 0.6 × 7-day + 0.4 × 30-day**, measured on the complete-in-box price
  where one exists, otherwise the loose price.

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
