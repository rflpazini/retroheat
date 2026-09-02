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

Every listing title is read in a fixed order:

1. **Rejected outright** — empty cases, box-only, manual-only, reproductions,
   lots and bundles, consoles, strategy guides, posters, demo discs, download
   codes, graded slabs, and anything for parts.
2. **Sealed** — "factory sealed", "brand new", "still sealed", and similar.
3. **Complete in box** — "CIB", "complete in box", "with manual".
4. **Loose** — "disc only", "cart only", "no manual", "unboxed".
5. **Unknown** — dropped.

Unknown listings are dropped rather than guessed. Guessing would bias the
medians, and a smaller honest sample beats a larger invented one. Phrases where
"complete" belongs to the product name, such as *Kingdom Hearts Complete
Edition*, are stripped before the complete-in-box rules run.

The eBay-supplied condition field is used only as a tiebreak, and only to
recognise a new copy.

## 4. Reducing a bucket to one price

Retro listings mix a tight cluster of real prices with a few fantasy prices.
Each condition bucket is trimmed with the interquartile rule — values outside
`[Q1 − 1.5 × IQR, Q3 + 1.5 × IQR]` are discarded — and the median of what
survives is published. A bucket needs **at least four** surviving listings to
be published at all.

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
