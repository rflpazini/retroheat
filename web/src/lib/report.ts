import { onShelf, type CollectionItem } from '@/lib/shelf'
import { PLATFORMS, type Platform, type PriceEntry } from '@/lib/types'

export interface PlatformRow {
  platform: Platform
  /** Copies on the shelf, and the distinct games they are copies of. */
  copies: number
  games: number
  /** How many games the collector tracks for the platform; null when the data does not say. */
  tracked: number | null
  value_cents: number
  unpriced: number
  /** This platform's part of the whole shelf's asking value, 0..1; 0 when nothing is priced. */
  share: number
  /** Copies with both a paid price and a price today; the sums below cover only those. */
  compared: number
  paid_cents: number
  today_cents: number
  gain_cents: number
  gain_pct: number | null
}

// Longest suffix first, so a platform whose code begins another's never wins by accident.
const BY_LENGTH = [...PLATFORMS].sort((a, b) => b.length - a.length)

/** The platform a catalog id names in its suffix (bully-ps2 → ps2), or null when it names none. */
export function platformOf(gameId: string): Platform | null {
  return BY_LENGTH.find((p) => gameId.endsWith(`-${p}`)) ?? null
}

/**
 * The shelf split by platform, the way About This Macintosh drew one bar per
 * program: what each platform holds, how much of the shelf's asking value it
 * is, and how it reads against what was paid. Most valuable first.
 */
export function shelfByPlatform(
  items: CollectionItem[],
  index: Map<string, PriceEntry>,
  tracked: Partial<Record<Platform, number>> | undefined,
): PlatformRow[] {
  const rows = new Map<Platform, PlatformRow & { ids: Set<string> }>()
  for (const item of items.filter(onShelf)) {
    const platform = platformOf(item.game_id)
    if (!platform) continue
    const row =
      rows.get(platform) ??
      {
        platform,
        copies: 0,
        games: 0,
        tracked: tracked?.[platform] ?? null,
        value_cents: 0,
        unpriced: 0,
        share: 0,
        compared: 0,
        paid_cents: 0,
        today_cents: 0,
        gain_cents: 0,
        gain_pct: null,
        ids: new Set<string>(),
      }
    rows.set(platform, row)
    row.copies++
    row.ids.add(item.game_id)
    const price = index.get(item.game_id)?.prices[item.condition] ?? null
    if (price === null) row.unpriced++
    else row.value_cents += price
    const paid = item.paid_cents ?? null
    if (price !== null && paid !== null) {
      row.compared++
      row.paid_cents += paid
      row.today_cents += price
    }
  }
  const total = [...rows.values()].reduce((sum, r) => sum + r.value_cents, 0)
  return [...rows.values()]
    .map(({ ids, ...r }) => ({
      ...r,
      games: ids.size,
      share: total > 0 ? r.value_cents / total : 0,
      gain_cents: r.today_cents - r.paid_cents,
      gain_pct: r.paid_cents > 0 ? ((r.today_cents - r.paid_cents) / r.paid_cents) * 100 : null,
    }))
    .sort((a, b) => b.value_cents - a.value_cents || a.platform.localeCompare(b.platform))
}
