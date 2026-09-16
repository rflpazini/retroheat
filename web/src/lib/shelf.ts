import { headlineFromMap } from '@/lib/format'
import type { Condition, PriceEntry } from '@/lib/types'

/** The signed-in person, reduced to what the menu bar shows. */
export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/**
 * One physical copy on a shelf: the game the catalog knows, the condition of
 * this copy, and what happened to it. A loose cart and a sealed box of the
 * same game are two items.
 */
export interface CollectionItem {
  /** The copy's own key. Absent (undefined) when the store predates migration 0004. */
  id?: string
  game_id: string
  condition: Condition
  added_at: string
  /**
   * Cents paid for the copy, in the boards' currency. null when nothing was
   * recorded; absent (undefined) when the store has no such column yet.
   */
  paid_cents?: number | null
  /** The day the copy was bought, YYYY-MM-DD; null when unknown. */
  acquired_on?: string | null
  notes?: string | null
  /** What the copy sold for, when it has been sold. */
  sold_cents?: number | null
  /** The day the copy was sold, YYYY-MM-DD. Set, the copy has left the shelf. */
  sold_on?: string | null
}

/** A copy still on the shelf, as opposed to one that was sold. */
export function onShelf(item: CollectionItem): boolean {
  return item.sold_on == null
}

/** A game kept to buy later, and the most its owner would pay for it, if they said. */
export interface SavedGame {
  game_id: string
  created_at: string
  /** Cents; null when no target was set, absent (undefined) when the store has no such column yet. */
  target_cents?: number | null
}

/** What a new copy is created from; the store adds the id and the date. */
export type NewCopy = Pick<CollectionItem, 'game_id' | 'condition'> &
  Partial<Pick<CollectionItem, 'paid_cents' | 'acquired_on' | 'notes'>>

/** The fields of a copy a person can change after it is on the shelf. */
export type CopyPatch = Partial<Pick<CollectionItem, 'condition' | 'paid_cents' | 'acquired_on' | 'notes' | 'sold_cents' | 'sold_on'>>

/** The most a copy can be recorded as costing, matching the database check. */
export const MAX_PAID_CENTS = 100_000_000
/** The longest note a copy can carry, matching the database check. */
export const MAX_NOTES = 500
/** How many copies an import writes per request; small enough for one round trip, large enough for a shelf. */
export const IMPORT_CHUNK = 100

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
  listSaved(): Promise<SavedGame[]>
  save(gameId: string): Promise<void>
  unsave(gameId: string): Promise<void>
  /** Sets, or with null forgets, the most the owner would pay for a saved game. */
  setTarget(gameId: string, cents: number | null): Promise<void>
  listCollection(): Promise<CollectionItem[]>
  /** Puts one more copy on the shelf and returns it as the store named it. */
  addCopy(copy: NewCopy): Promise<CollectionItem>
  /** Puts many copies on the shelf at once (an import), in chunks of IMPORT_CHUNK. */
  addCopies(copies: NewCopy[]): Promise<CollectionItem[]>
  updateCopy(id: string, patch: CopyPatch): Promise<void>
  removeCopy(id: string): Promise<void>
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
  /** False when the store has no copy ids yet (migration 0004 not applied), so nothing can be written. */
  copies_supported: boolean
  /** How many copies have both a paid price and a price today; the sums below cover only those. */
  compared: number
  paid_cents: number
  today_cents: number
  gain_cents: number
  gain_pct: number | null
}

export interface TargetHit {
  game_id: string
  target_cents: number
  /** Today's headline asking price, the one the saved list leads with. */
  asking_cents: number
  condition: Condition
}

/**
 * The saved games asking no more than their owner would pay, read from the
 * day's medians when the page opens. Nothing watches and nothing is sent;
 * the list is the alert.
 */
export function underTarget(saved: SavedGame[], index: Map<string, PriceEntry>): TargetHit[] {
  const hits: TargetHit[] = []
  for (const s of saved) {
    if (s.target_cents == null) continue
    const headline = headlineFromMap(index.get(s.game_id)?.prices)
    if (!headline || headline.cents > s.target_cents) continue
    hits.push({ game_id: s.game_id, target_cents: s.target_cents, asking_cents: headline.cents, condition: headline.condition })
  }
  return hits
}

export interface SoldLine {
  item: CollectionItem
  paid_cents: number | null
  sold_cents: number | null
  /** What the copy sold for less what it cost; null unless both are known. */
  gain_cents: number | null
  gain_pct: number | null
}

export interface SoldSummary {
  /** Newest sale first. */
  lines: SoldLine[]
  /** How many sales have both a paid and a sold price; the sums below cover only those. */
  compared: number
  paid_cents: number
  sold_cents: number
  gain_cents: number
  gain_pct: number | null
}

/**
 * The copies that left the shelf, and what they realized: the gain that is
 * no longer an asking price but money that changed hands.
 */
export function soldSummary(items: CollectionItem[]): SoldSummary {
  const lines: SoldLine[] = items
    .filter((item) => !onShelf(item))
    .map((item) => {
      const paid_cents = item.paid_cents ?? null
      const sold_cents = item.sold_cents ?? null
      const gain_cents = paid_cents !== null && sold_cents !== null ? sold_cents - paid_cents : null
      const gain_pct = gain_cents !== null && paid_cents! > 0 ? (gain_cents / paid_cents!) * 100 : null
      return { item, paid_cents, sold_cents, gain_cents, gain_pct }
    })
    .sort((a, b) => (b.item.sold_on ?? '').localeCompare(a.item.sold_on ?? ''))
  const compared = lines.filter((l) => l.gain_cents !== null)
  const paid_cents = compared.reduce((sum, l) => sum + (l.paid_cents ?? 0), 0)
  const sold_cents = compared.reduce((sum, l) => sum + (l.sold_cents ?? 0), 0)
  const gain_cents = sold_cents - paid_cents
  return {
    lines,
    compared: compared.length,
    paid_cents,
    sold_cents,
    gain_cents,
    gain_pct: paid_cents > 0 ? (gain_cents / paid_cents) * 100 : null,
  }
}

/**
 * What a shelf is asking today: the sum of each copy's median at the
 * condition of that copy. Sold copies are history, not shelf, and stay out.
 * Asking prices, not appraisals, and the page says so.
 */
export function shelfValue(items: CollectionItem[], index: Map<string, PriceEntry>, moverLimit = 5): ShelfValue {
  const lines: ShelfLine[] = items.filter(onShelf).map((item) => {
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
  // A move belongs to the game, not to each copy of it: one line per game.
  const seen = new Set<string>()
  const movers = lines
    .filter((l) => l.entry?.pct_7d != null)
    .sort((a, b) => Math.abs(b.entry!.pct_7d!) - Math.abs(a.entry!.pct_7d!))
    .filter((l) => !seen.has(l.item.game_id) && seen.add(l.item.game_id))
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
    copies_supported: items.every((item) => item.id !== undefined),
    compared: compared.length,
    paid_cents,
    today_cents,
    gain_cents,
    gain_pct: paid_cents > 0 ? (gain_cents / paid_cents) * 100 : null,
  }
}
