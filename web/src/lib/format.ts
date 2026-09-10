import { CONDITIONS, type Condition, type Price, type PriceMap, type Prices } from './types'

export function money(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  return dollars >= 1000
    ? `$${Math.round(dollars).toLocaleString('en-US')}`
    : `$${dollars.toFixed(2)}`
}

/** Money to the cent whatever the size, for a ledger where the cents are the point. */
export function moneyExact(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A gain or loss in money, to the cent and with its sign; zero and unknown stay plain. */
export function signedMoney(cents: number | null | undefined): string {
  if (cents == null) return '—'
  if (cents === 0) return moneyExact(0)
  return `${cents < 0 ? '-' : '+'}${moneyExact(Math.abs(cents))}`
}

/**
 * What a person typed for a price, in cents, or null when it is not one.
 * Accepts a currency sign, thousands separators, and either "." or "," as
 * the decimal mark: a Brazilian keyboard types 12,50 and means $12.50. When
 * both marks appear the later one is the decimal; a lone mark is the decimal
 * when one or two digits follow it, and a thousands separator when exactly
 * three do.
 */
export function parseMoney(text: string): number | null {
  const raw = text.replace(/[^\d.,-]/g, '')
  if (!raw || raw.includes('-')) return null
  const lastDot = raw.lastIndexOf('.')
  const lastComma = raw.lastIndexOf(',')
  const at = Math.max(lastDot, lastComma)
  let normalised = raw
  if (at !== -1) {
    const after = raw.slice(at + 1)
    const both = lastDot !== -1 && lastComma !== -1
    const digits = (part: string) => part.replace(/[.,]/g, '')
    if (both || after.length <= 2) normalised = `${digits(raw.slice(0, at)) || '0'}.${after}`
    else if (after.length === 3) normalised = digits(raw)
    else return null
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null
  return Math.round(Number(normalised) * 100)
}

export function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`
}

/**
 * heat maps a percentage move to one of six bands. The same ramp drives row
 * spines, badges and the chart stroke, so a colour means the same thing
 * everywhere on the site.
 */
export function heat(value: number | null | undefined): string {
  if (value == null) return 'var(--heat-flat)'
  if (value <= -8) return 'var(--heat-cold)'
  if (value <= -2) return 'var(--heat-cool)'
  if (value < 2) return 'var(--heat-flat)'
  if (value < 8) return 'var(--heat-warm)'
  if (value < 20) return 'var(--heat-hot)'
  return 'var(--heat-blaze)'
}

/** The word behind the colour, so direction is not conveyed by hue alone. */
export function trendLabel(value: number | null | undefined): 'Rising' | 'Cooling' | 'Flat' {
  if (value == null) return 'Flat'
  if (value >= 2) return 'Rising'
  if (value <= -2) return 'Cooling'
  return 'Flat'
}

/** One colour per condition column, matching its sparkline. */
export function conditionColor(condition: Condition): string {
  return `var(--cond-${condition === 'new' ? 'new' : condition})`
}

export function priceFor(prices: Prices, condition: Condition) {
  return prices[condition]
}

export function headlinePrice(prices: Prices): { condition: Condition; cents: number } | null {
  if (prices.cib) return { condition: 'cib', cents: prices.cib.median_cents }
  if (prices.loose) return { condition: 'loose', cents: prices.loose.median_cents }
  if (prices.new) return { condition: 'new', cents: prices.new.median_cents }
  return null
}

/** The medians of a Prices block as a flat map, so boards and files agree on one shape. */
/** The condition a list leads with when only medians are known: complete, else loose, else sealed. */
export function headlineFromMap(m: PriceMap | undefined): { condition: Condition; cents: number } | null {
  if (!m) return null
  for (const c of ['cib', 'loose', 'new'] as const) {
    const cents = m[c]
    if (cents != null) return { condition: c, cents }
  }
  return null
}

export function priceMap(prices: Prices): PriceMap {
  const out: PriceMap = {}
  for (const c of CONDITIONS) {
    const p = prices[c]
    if (p) out[c] = p.median_cents
  }
  return out
}

/**
 * companions lists every priced condition except the one leading, in shelf
 * order. A complete-copy headline of $134.82 reads as a mistake to someone who
 * has only seen loose carts at $45; printing "Loose $45.00" beside it settles
 * which market each number describes.
 */
export function companions(
  prices: PriceMap | undefined,
  headline: Condition,
): { condition: Condition; cents: number }[] {
  if (!prices) return []
  return CONDITIONS.filter((c) => c !== headline && prices[c] != null).map((c) => ({
    condition: c,
    cents: prices[c] as number,
  }))
}

/** "$110.00–$170.00": where the middle half of sellers sit, or null when the file has no quartiles. */
export function middleHalf(price: Price | undefined): string | null {
  if (price?.q1_cents == null || price.q3_cents == null) return null
  return `${money(price.q1_cents)}–${money(price.q3_cents)}`
}

export function relativeDay(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDate(iso: string): string {
  // A bare calendar date carries no zone. Date would read it as UTC midnight
  // and print the previous day anywhere west of Greenwich, so build it as a
  // local date instead; full timestamps keep their own zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
