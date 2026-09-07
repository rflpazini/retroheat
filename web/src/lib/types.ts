export type Condition = 'loose' | 'cib' | 'new'

export const CONDITIONS: Condition[] = ['loose', 'cib', 'new']

/** Cents per condition, for files that carry one figure rather than a full Price. */
export type PriceMap = Partial<Record<Condition, number>>

export const PLATFORMS = ['ps2', 'gamecube', 'psp', 'vita', 'n64', 'dreamcast'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  ps2: 'PlayStation 2',
  gamecube: 'GameCube',
  psp: 'PSP',
  vita: 'PS Vita',
  n64: 'Nintendo 64',
  dreamcast: 'Dreamcast',
}

export const PLATFORM_SHORT: Record<Platform, string> = {
  ps2: 'PS2',
  gamecube: 'GCN',
  psp: 'PSP',
  vita: 'VITA',
  n64: 'N64',
  dreamcast: 'DC',
}

export const CONDITION_LABELS: Record<Condition, string> = {
  loose: 'Loose',
  cib: 'Complete',
  new: 'Sealed',
}

export interface Price {
  median_cents: number
  /** Most common whole-dollar price point. Absent when the provider supplies a single figure. */
  mode_cents?: number
  /** Bounds of the middle half of the asking prices. Absent when the provider supplies a single figure. */
  q1_cents?: number
  q3_cents?: number
  n: number
}

export interface Prices {
  loose?: Price
  cib?: Price
  new?: Price
}

/** One smoothed series per condition, so each price column charts its own. */
export interface Sparks {
  loose?: number[]
  cib?: number[]
  new?: number[]
}

export interface LatestGame {
  id: string
  title: string
  region: string
  variant: string
  prices: Prices
  pct_1d: number | null
  pct_7d: number | null
  pct_30d: number | null
  sparks: Sparks
  stale: boolean
  as_of: string
}

export interface LatestFile {
  platform: Platform
  as_of: string
  source: string
  price_kind: string
  games: LatestGame[]
}

export interface Annotation {
  date: string
  note: string
  source_url?: string
}

export interface TrendEntry {
  id: string
  title: string
  platform: Platform
  headline_condition: Condition
  price_cents: number
  /** Latest median per condition with enough listings behind it. Absent in files written before it was recorded. */
  prices?: PriceMap
  /** Raw change against the previous day's point; noisy by design. */
  pct_1d: number | null
  pct_7d: number | null
  pct_30d: number | null
  score: number
  spark: number[]
  annotation?: Annotation
}

export interface TrendingFile {
  board: string
  as_of: string
  entries: TrendEntry[]
}

export interface Meta {
  generated_at: string
  source: string
  price_kind: string
  counts: { tracked: number; ok: number; stale: number; failed: number }
  api_calls_used: number
  platforms: Platform[]
}

export interface HistoryPoint {
  d: string
  r: 'd' | 'w'
  loose: number | null
  cib: number | null
  new: number | null
  nl: number
  nc: number
  nn: number
}

export interface HistoryFile {
  id: string
  points: HistoryPoint[]
}

/** Editorial facts a contributor wrote about a release. */
export interface GameInfo {
  developer?: string
  publisher?: string
  year?: number
  genre?: string
  cover_url?: string
  /** Short factual description, normally the Wikipedia lead; about_url credits it. */
  about?: string
  about_url?: string
  trivia?: string
  why?: string
}

export interface CatalogGame {
  id: string
  title: string
  platform: Platform
  region: string
  variant: string
  igdb_id?: number
  ebay_url?: string
  info?: GameInfo
  annotation?: Annotation
}

export interface CatalogFile {
  as_of: string
  games: CatalogGame[]
}
