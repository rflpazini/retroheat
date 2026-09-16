import { parseDay } from '@/lib/day'
import { parseMoney } from '@/lib/format'
import { platformOf } from '@/lib/report'
import { fold, score } from '@/lib/search'
import { onShelf, type CollectionItem, type NewCopy } from '@/lib/shelf'
import { CONDITIONS, CONDITION_LABELS, type CatalogGame, type Condition, type Platform } from '@/lib/types'

/*
  Bringing a shelf in from another tool. Files are read by header name, never
  by column position, because the tools reorder columns between versions and
  a shelf imported into the wrong column is worse than one not imported.
  Nothing is guessed: an unknown platform or an unreadable condition is
  reported and skipped, and a title that could be two games asks for a pick.
*/

export type ImportFormat = 'retroheat' | 'gameye' | 'pricecharting'

export interface ImportRow {
  /** Line in the file, for the review list. */
  line: number
  title: string
  platformName: string
  platform: Platform | null
  condition: Condition | null
  paid_cents: number | null
  acquired_on: string | null
  notes: string | null
  /** RetroHeat's own export names the game outright. */
  game_id?: string
  /** Why the row will not come in, when it will not. */
  skip?: string
  /** Something worth saying about a row that will come in. */
  note?: string
}

export type Match =
  | { kind: 'match'; row: ImportRow; game: CatalogGame; score: number }
  | { kind: 'pick'; row: ImportRow; candidates: CatalogGame[] }
  | { kind: 'skip'; row: ImportRow; reason: string }

// The tools write these where a value is missing.
const NULLS = new Set(['', '?', 'missing field', '-1.0', '-1', 'n/a', 'null', 'none'])
const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return NULLS.has(t.toLowerCase()) ? null : t
}

// Console names as PriceCharting, GAMEYE and sellers write them, folded.
const PLATFORM_NAMES: Record<string, Platform> = {
  'playstation 2': 'ps2',
  playstation2: 'ps2',
  ps2: 'ps2',
  'sony playstation 2': 'ps2',
  gamecube: 'gamecube',
  'nintendo gamecube': 'gamecube',
  gcn: 'gamecube',
  ngc: 'gamecube',
  psp: 'psp',
  'playstation portable': 'psp',
  'sony psp': 'psp',
  'playstation vita': 'vita',
  'ps vita': 'vita',
  psvita: 'vita',
  vita: 'vita',
  'sony playstation vita': 'vita',
  'nintendo 64': 'n64',
  n64: 'n64',
  'sega dreamcast': 'dreamcast',
  dreamcast: 'dreamcast',
  dc: 'dreamcast',
  'game boy': 'gb',
  gameboy: 'gb',
  gb: 'gb',
  'nintendo game boy': 'gb',
  'nintendo gameboy': 'gb',
  'game boy color': 'gbc',
  'gameboy color': 'gbc',
  gbc: 'gbc',
  'nintendo game boy color': 'gbc',
  'game boy advance': 'gba',
  'gameboy advance': 'gba',
  gba: 'gba',
  'nintendo game boy advance': 'gba',
}

/** The platform a console name means, or null when RetroHeat does not track it. */
export function platformNamed(name: string): Platform | null {
  const f = fold(name)
  return f ? (PLATFORM_NAMES[f] ?? null) : null
}

const lower = (header: string[]) => header.map((h) => h.trim().toLowerCase())

/** Which tool wrote the file, told by its header; null when none of the known ones did. */
export function detectFormat(header: string[]): ImportFormat | null {
  const h = new Set(lower(header))
  if (h.has('game_id') && h.has('condition') && h.has('added_at')) return 'retroheat'
  if (h.has('ownership') && h.has('title') && h.has('platform')) return 'gameye'
  const product = h.has('product-name') || h.has('product name')
  const console = h.has('console-name') || h.has('console name') || h.has('console')
  if (product && console) return 'pricecharting'
  return null
}

/** GAMEYE's ownership labels, and what each is worth on this shelf. */
function gameyeCondition(label: string | null): { condition: Condition; note?: string } | { skip: string } {
  const l = (label ?? '').toLowerCase().replace(/\+$/, '')
  switch (l) {
    case 'new':
      return { condition: 'new' }
    case 'cib':
      return { condition: 'cib' }
    case 'loose':
      return { condition: 'loose' }
    case 'boxed':
      return { condition: 'loose', note: 'Boxed without a manual is not complete: imported as loose' }
    case 'manual':
      return { skip: 'Manual only, not a copy of the game' }
    case 'box':
      return { skip: 'Box only, not a copy of the game' }
    case 'digital':
      return { skip: 'Digital copy; the shelf holds physical copies' }
    default:
      return { skip: label ? `Ownership "${label}" is not a copy` : 'No ownership given' }
  }
}

/** PriceCharting's condition words, and the same three buckets. */
function pricechartingCondition(label: string | null): { condition: Condition; note?: string } | { skip: string } {
  const l = (label ?? '').toLowerCase()
  if (!l) return { condition: 'loose', note: 'No condition given: imported as loose' }
  if (/graded|psa|cgc|wata|vga/.test(l)) return { skip: 'Graded copies are out of scope' }
  if (/box only|manual only/.test(l)) return { skip: `${label} is not a copy of the game` }
  if (/new|sealed/.test(l)) return { condition: 'new' }
  if (/cib|complete|box.*manual/.test(l)) return { condition: 'cib' }
  if (/loose|game only|cart|disc/.test(l)) return { condition: 'loose' }
  return { skip: `Condition "${label}" is not one the shelf knows` }
}

/**
 * Reads the records of a known format into rows the matcher understands.
 * The first record is the header; every value is looked up by its name.
 */
export function readRows(format: ImportFormat, records: string[][]): ImportRow[] {
  const [header = [], ...body] = records
  const names = lower(header)
  const col = (record: string[], ...candidates: string[]): string | null => {
    for (const c of candidates) {
      const i = names.indexOf(c)
      if (i >= 0) return clean(record[i])
    }
    return null
  }
  return body.map((record, k): ImportRow => {
    const line = k + 2
    const base = { line, paid_cents: null as number | null, acquired_on: null as string | null, notes: null as string | null }
    if (format === 'retroheat') {
      const game_id = col(record, 'game_id') ?? ''
      const platform = platformOf(game_id)
      const cond = col(record, 'condition')
      const row: ImportRow = {
        ...base,
        title: col(record, 'title') ?? game_id,
        platformName: platform ?? '',
        platform,
        condition: CONDITIONS.includes(cond as Condition) ? (cond as Condition) : null,
        paid_cents: parseMoney(col(record, 'paid') ?? ''),
        acquired_on: parseDay(col(record, 'acquired_on') ?? ''),
        notes: col(record, 'notes'),
        game_id,
      }
      if (col(record, 'sold_on') || col(record, 'sold')) row.skip = 'Sold copy; it stays where it is'
      else if (!row.condition) row.skip = `Condition "${cond ?? ''}" is not loose, cib or new`
      return row
    }
    if (format === 'gameye') {
      const category = col(record, 'category')
      const platformName = col(record, 'platform') ?? ''
      const platform = platformNamed(platformName)
      const row: ImportRow = {
        ...base,
        title: col(record, 'title') ?? '',
        platformName,
        platform,
        condition: null,
        paid_cents: parseMoney(col(record, 'pricepaid', 'price paid') ?? ''),
        notes: col(record, 'notes'),
      }
      if (category && category.toLowerCase() !== 'games') row.skip = `Not a game (${category})`
      else if (!platform) row.skip = `Unknown platform: ${platformName || '(none)'}`
      else {
        const c = gameyeCondition(col(record, 'ownership'))
        if ('skip' in c) row.skip = c.skip
        else {
          row.condition = c.condition
          row.note = c.note
        }
      }
      return row
    }
    const platformName = col(record, 'console-name', 'console name', 'console', 'platform', 'system') ?? ''
    const platform = platformNamed(platformName)
    const row: ImportRow = {
      ...base,
      title: col(record, 'product-name', 'product name', 'product', 'title', 'name') ?? '',
      platformName,
      platform,
      condition: null,
      paid_cents: parseMoney(col(record, 'price-paid', 'price paid', 'paid', 'purchase-price', 'cost') ?? ''),
      acquired_on: parseDay(col(record, 'date-added', 'purchase-date', 'acquired', 'date') ?? ''),
      notes: col(record, 'notes', 'description'),
    }
    if (!platform) row.skip = `Unknown platform: ${platformName || '(none)'}`
    else {
      const c = pricechartingCondition(col(record, 'condition', 'include', 'completeness'))
      if ('skip' in c) row.skip = c.skip
      else {
        row.condition = c.condition
        row.note = c.note
      }
    }
    return row
  })
}

const MATCH = 72
const PICK = 50

/**
 * Finds each row's game among the catalog's games on the row's platform.
 * The title is scored word by word with the search ranking; the platform is
 * taken from the file, never from a word in the title, so "Dolce Vita" on
 * PlayStation 2 stays a PlayStation 2 game. A clear best match comes in; a
 * weak one or a tie asks for a pick; the rest is reported as not tracked.
 */
export function matchRows(
  rows: ImportRow[],
  games: CatalogGame[],
  opts: { existing?: CollectionItem[]; dedupe?: boolean },
): Match[] {
  const held = new Set(
    (opts.existing ?? []).filter(onShelf).map((i) => `${i.game_id}:${i.condition}`),
  )
  const accept = (row: ImportRow, game: CatalogGame, s: number): Match => {
    if (opts.dedupe && row.condition && held.has(`${game.id}:${row.condition}`)) {
      return { kind: 'skip', row, reason: `Already on the shelf as ${CONDITION_LABELS[row.condition]}` }
    }
    return { kind: 'match', row, game, score: s }
  }
  return rows.map((row): Match => {
    if (row.skip) return { kind: 'skip', row, reason: row.skip }
    if (row.game_id) {
      const game = games.find((g) => g.id === row.game_id)
      return game ? accept(row, game, 100) : { kind: 'skip', row, reason: `Not tracked: ${row.game_id}` }
    }
    if (!row.platform) return { kind: 'skip', row, reason: `Unknown platform: ${row.platformName}` }
    if (!row.condition) return { kind: 'skip', row, reason: 'No condition' }
    const words = fold(row.title).split(' ').filter(Boolean)
    if (words.length === 0) return { kind: 'skip', row, reason: 'No title' }
    const scored = games
      .filter((g) => g.platform === row.platform)
      .map((game) => ({ game, s: score(words, game) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.game.title.length - b.game.title.length || a.game.title.localeCompare(b.game.title))
    const best = scored[0]
    if (!best || best.s < PICK) return { kind: 'skip', row, reason: `Not tracked: ${row.title}` }
    const runnerUp = scored[1]?.s ?? 0
    if (best.s >= MATCH && runnerUp < best.s) return accept(row, best.game, best.s)
    return { kind: 'pick', row, candidates: scored.slice(0, 3).map((x) => x.game) }
  })
}

/** The copies the matches make, for the shelf to add. */
export function toCopies(matches: Match[]): NewCopy[] {
  return matches.flatMap((m) =>
    m.kind === 'match' && m.row.condition
      ? [{ game_id: m.game.id, condition: m.row.condition, paid_cents: m.row.paid_cents, acquired_on: m.row.acquired_on, notes: m.row.notes }]
      : [],
  )
}
