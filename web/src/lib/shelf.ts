import type { Condition, PriceEntry } from '@/lib/types'

/** The signed-in person, reduced to what the menu bar shows. */
export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/** One owned game: the id the catalog uses, the condition of the copy, and what it cost, if known. */
export interface CollectionItem {
  game_id: string
  condition: Condition
  added_at: string
  /**
   * Cents paid for the copy, in the boards' currency. null when nothing was
   * recorded; absent (undefined) when the store has no such column yet.
   */
  paid_cents?: number | null
}

/** The most a copy can be recorded as costing, matching the database check. */
export const MAX_PAID_CENTS = 100_000_000

export type AuthEvent = 'initial' | 'signed-in' | 'signed-out' | 'refresh'

/**
 * Everything the account features need from a backend, so the site can run
 * against Supabase in production and against an in-memory fake in tests, and
 * so the Supabase SDK is only ever loaded through one module.
 */
export interface ShelfBackend {
  getUser(): Promise<AuthUser | null>
  onAuthChange(cb: (user: AuthUser | null, event: AuthEvent) => void): () => void
  signInWithGoogle(redirectTo: string): Promise<void>
  signInWithEmail(email: string, redirectTo: string): Promise<void>
  signOut(): Promise<void>
  listSaved(): Promise<string[]>
  save(gameId: string): Promise<void>
  unsave(gameId: string): Promise<void>
  listCollection(): Promise<CollectionItem[]>
  own(gameId: string, condition: Condition): Promise<void>
  disown(gameId: string): Promise<void>
  /** Records (or with null, forgets) what an owned copy cost. */
  setPaid(gameId: string, cents: number | null): Promise<void>
  deleteAccount(): Promise<void>
}

export interface ShelfLine {
  item: CollectionItem
  entry?: PriceEntry
  /** Today's asking median for the copy's own condition, or null when unpriced. */
  price_cents: number | null
  /** What the copy cost, when recorded. */
  paid_cents: number | null
  /** Today's price less what was paid; null unless both are known. */
  gain_cents: number | null
  /** The gain as a share of what was paid; null unless both are known and something was paid. */
  gain_pct: number | null
}

export interface ShelfValue {
  total_cents: number
  priced: number
  unpriced: number
  /** Priced first by value descending, then unpriced by id. */
  lines: ShelfLine[]
  /** The owned games that moved most this week, largest absolute move first. */
  movers: ShelfLine[]
  /** False when the store cannot hold a paid price yet (migration not applied). */
  paid_supported: boolean
  /** How many copies have both a paid price and a price today; the sums below cover only those. */
  compared: number
  paid_cents: number
  today_cents: number
  gain_cents: number
  gain_pct: number | null
}

/**
 * What a shelf is asking today: the sum of each owned game's median at the
 * condition owned. Asking prices, not appraisals, and the page says so.
 */
export function shelfValue(items: CollectionItem[], index: Map<string, PriceEntry>, moverLimit = 5): ShelfValue {
  const lines: ShelfLine[] = items.map((item) => {
    const entry = index.get(item.game_id)
    const price_cents = entry?.prices[item.condition] ?? null
    const paid_cents = item.paid_cents ?? null
    const gain_cents = price_cents !== null && paid_cents !== null ? price_cents - paid_cents : null
    const gain_pct = gain_cents !== null && paid_cents! > 0 ? (gain_cents / paid_cents!) * 100 : null
    return { item, entry, price_cents, paid_cents, gain_cents, gain_pct }
  })
  lines.sort((a, b) => {
    if (a.price_cents === null && b.price_cents === null) return a.item.game_id.localeCompare(b.item.game_id)
    if (a.price_cents === null) return 1
    if (b.price_cents === null) return -1
    return b.price_cents - a.price_cents
  })
  const priced = lines.filter((l) => l.price_cents !== null)
  const movers = lines
    .filter((l) => l.entry?.pct_7d != null)
    .sort((a, b) => Math.abs(b.entry!.pct_7d!) - Math.abs(a.entry!.pct_7d!))
    .slice(0, moverLimit)
  const compared = lines.filter((l) => l.gain_cents !== null)
  const paid_cents = compared.reduce((sum, l) => sum + (l.paid_cents ?? 0), 0)
  const today_cents = compared.reduce((sum, l) => sum + (l.price_cents ?? 0), 0)
  const gain_cents = today_cents - paid_cents
  return {
    total_cents: priced.reduce((sum, l) => sum + (l.price_cents ?? 0), 0),
    priced: priced.length,
    unpriced: lines.length - priced.length,
    lines,
    movers,
    paid_supported: items.every((item) => item.paid_cents !== undefined),
    compared: compared.length,
    paid_cents,
    today_cents,
    gain_cents,
    gain_pct: paid_cents > 0 ? (gain_cents / paid_cents) * 100 : null,
  }
}
