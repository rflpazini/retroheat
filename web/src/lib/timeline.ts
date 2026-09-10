import type { CollectionItem } from '@/lib/shelf'
import type { HistoryPoint } from '@/lib/types'

export interface TimelinePoint {
  date: string
  /** What the charted copies would have asked on that day, each at its last known price by then. */
  value_cents: number
}

export interface Timeline {
  points: TimelinePoint[]
  /** Copies on the line: at least one price at their condition in the current series. */
  priced: number
  total: number
  /** What was paid for the copies on the line, summed over those that record it, and how many do. */
  paid_cents: number
  paid_covers: number
}

/**
 * The shelf as it stands today, priced on every day the history knows. The
 * line starts on the first day every charted copy has a price, so a move on
 * it is a price move and never a copy joining; from there each copy keeps
 * its last known price across days without one, the way a portfolio chart
 * carries a holding. Only the newest classifier series of each game counts,
 * as on the game page, so a rule change never reads as a move. When the
 * collector added a copy to the shelf plays no part: the line answers "what
 * would my shelf have asked", not "what did I own then".
 */
export function collectionTimeline(items: CollectionItem[], histories: Map<string, HistoryPoint[]>): Timeline {
  const series: { item: CollectionItem; dates: string[]; cents: number[] }[] = []
  for (const item of items) {
    const points = histories.get(item.game_id)
    if (!points || points.length === 0) continue
    const currentV = points[points.length - 1].v ?? 0
    const dates: string[] = []
    const cents: number[] = []
    for (const p of points) {
      if ((p.v ?? 0) !== currentV) continue
      const c = p[item.condition]
      if (c == null) continue
      dates.push(p.d)
      cents.push(c)
    }
    if (dates.length > 0) series.push({ item, dates, cents })
  }

  // The first day every copy has a price is the latest of their first days.
  const start = series.reduce((latest, s) => (s.dates[0] > latest ? s.dates[0] : latest), '')
  const allDates = [...new Set(series.flatMap((s) => s.dates))].filter((d) => d >= start).sort()
  const at = series.map(() => 0)
  const points = allDates.map((date) => {
    let value_cents = 0
    series.forEach((s, i) => {
      while (at[i] + 1 < s.dates.length && s.dates[at[i] + 1] <= date) at[i]++
      value_cents += s.cents[at[i]]
    })
    return { date, value_cents }
  })

  const withPaid = series.filter((s) => s.item.paid_cents != null)
  return {
    points,
    priced: series.length,
    total: items.length,
    paid_cents: withPaid.reduce((sum, s) => sum + (s.item.paid_cents ?? 0), 0),
    paid_covers: withPaid.length,
  }
}
