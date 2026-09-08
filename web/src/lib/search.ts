import { PLATFORMS, PLATFORM_LABELS, PLATFORM_SHORT, type CatalogGame, type Platform } from './types'

/**
 * Ranking for the Spotlight palette. It is deliberately plain: prefix and
 * word matches people can predict, not a similarity score they cannot. A
 * game shows up because you typed part of its name, its initials, or its
 * name plus a platform, and it is ranked by how directly you named it.
 */

const ROMAN: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6',
  vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12',
}

/** Lowercase, accent-folded, punctuation collapsed to spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Tokens with their numeral aliases: "VIII" also answers to "8" and "x" to
 * "10", so "dragon quest 8" finds Dragon Quest VIII and "f-zero x" still
 * finds F-Zero X. Both spellings stay in the set; nothing is guessed away.
 */
function tokens(s: string): string[] {
  const out: string[] = []
  for (const t of fold(s).split(' ')) {
    if (!t) continue
    out.push(t)
    if (ROMAN[t]) out.push(ROMAN[t])
  }
  return out
}

const PLATFORM_ALIASES: Record<string, Platform> = (() => {
  const m: Record<string, Platform> = {}
  for (const p of PLATFORMS) {
    m[p] = p
    m[fold(PLATFORM_SHORT[p])] = p
    m[fold(PLATFORM_LABELS[p]).replace(/ /g, '')] = p
  }
  m.playstation2 = 'ps2'
  m.gc = 'gamecube'
  m.ngc = 'gamecube'
  m.psvita = 'vita'
  m.nintendo64 = 'n64'
  m.dc = 'dreamcast'
  return m
})()

export interface Parsed {
  /** Query words that are not a platform name. */
  words: string[]
  /** A platform the query named, used as a hard filter. */
  platform: Platform | null
}

/**
 * parse splits "bully ps2" into the words to match and the platform to keep.
 * Only a standalone platform word counts as a filter; "vita" inside a title
 * such as "Dolce Vita" would still be typed as part of a longer phrase and
 * matched as text.
 */
export function parse(query: string): Parsed {
  const words: string[] = []
  let platform: Platform | null = null
  for (const w of fold(query).split(' ')) {
    if (!w) continue
    const p = PLATFORM_ALIASES[w]
    if (p && platform === null) {
      platform = p
      continue
    }
    words.push(w)
  }
  return { words, platform }
}

export interface Hit<T> {
  item: T
  score: number
}

export interface Searchable {
  title: string
  platform: Platform
  info?: { developer?: string; publisher?: string; year?: number }
}

function initials(title: string): string {
  return fold(title)
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
}

interface Prepared {
  title: string
  titleTokens: string[]
  initials: string
  wide: string[]
}

// Folding and tokenising every title again on each keystroke is wasted work
// that grows with the catalog; a game's words never change while it is loaded.
const prepared = new WeakMap<Searchable, Prepared>()

function prepare(game: Searchable): Prepared {
  let p = prepared.get(game)
  if (!p) {
    const titleTokens = tokens(game.title)
    const extra = tokens(
      [game.info?.developer, game.info?.publisher, game.info?.year?.toString()].filter(Boolean).join(' '),
    )
    p = { title: fold(game.title), titleTokens, initials: initials(game.title), wide: [...titleTokens, ...extra] }
    prepared.set(game, p)
  }
  return p
}

function prefixed(word: string, haystack: string[]): boolean {
  return haystack.some((t) => t.startsWith(word))
}

/**
 * score says how directly a query names a game, or 0 when it does not.
 * Tiers, best first: the whole title, the start of the title, the start of a
 * word in it, every query word starting some title word, the title's
 * initials, any substring, and last a match that needed the developer,
 * publisher or year to complete.
 */
export function score(words: string[], game: Searchable): number {
  if (words.length === 0) return 1
  const { title, titleTokens, initials: init, wide } = prepare(game)
  const phrase = words.join(' ')

  if (title === phrase) return 100
  if (title.startsWith(phrase)) return 90
  if (title.includes(` ${phrase}`)) return 80

  const allInTitle = words.every((w) => prefixed(w, titleTokens))
  if (allInTitle) {
    // In-order words read like the title; out-of-order still count.
    const idx = words.map((w) => titleTokens.findIndex((t) => t.startsWith(w)))
    const inOrder = idx.every((i, k) => k === 0 || i >= idx[k - 1])
    return inOrder ? 72 : 70
  }

  if (words.length === 1 && phrase.length >= 3 && init.startsWith(phrase)) return 60
  if (title.includes(phrase)) return 50

  if (words.every((w) => prefixed(w, wide))) return 40

  return 0
}

/**
 * rank returns the best matches for a query, most direct first. Ties break
 * toward the shorter title, then alphabetically, so "Bully" outranks a
 * longer title that happens to contain the word.
 */
export function rank<T extends Searchable>(query: string, games: T[], limit = 12): Hit<T>[] {
  const { words, platform } = parse(query)
  if (words.length === 0 && platform === null) return []

  const hits: Hit<T>[] = []
  for (const g of games) {
    if (platform && g.platform !== platform) continue
    const s = score(words, g)
    if (s > 0) hits.push({ item: g, score: s })
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.title.length - b.item.title.length ||
      a.item.title.localeCompare(b.item.title),
  )
  return hits.slice(0, limit)
}

export interface Board {
  to: string
  label: string
  /** Extra words the board answers to besides its label. */
  keywords: string[]
}

export const BOARDS: Board[] = [
  { to: '/', label: 'Trending', keywords: ['home', 'movers', 'hot'] },
  ...PLATFORMS.map((p) => ({
    to: `/p/${p}`,
    label: `${PLATFORM_LABELS[p]} board`,
    keywords: [p, PLATFORM_SHORT[p], PLATFORM_LABELS[p]],
  })),
  { to: '/about', label: 'Methodology', keywords: ['about', 'help', 'how', 'method'] },
]

/** The signed-in person's own boards; offered only when accounts are on. */
export const SHELF_BOARDS: Board[] = [
  { to: '/saved', label: 'Saved games', keywords: ['saved', 'wishlist', 'shelf', 'bookmarks', 'mine'] },
  { to: '/collection', label: 'My collection', keywords: ['collection', 'owned', 'shelf', 'value', 'mine'] },
]

/** rankBoards matches destinations by label or keyword prefix. */
export function rankBoards(query: string, boards: Board[] = BOARDS): Board[] {
  const words = fold(query).split(' ').filter(Boolean)
  if (words.length === 0) return boards
  return boards.filter((b) => {
    const hay = tokens([b.label, ...b.keywords].join(' '))
    return words.every((w) => prefixed(w, hay))
  })
}

export type { CatalogGame }
