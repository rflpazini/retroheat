import { describe, expect, it } from 'vitest'
import { companions, formatDate, headlinePrice, heat, middleHalf, money, moneyExact, pct, priceMap, parseMoney, signedMoney } from './format'

describe('money', () => {
  it('shows cents below a thousand dollars', () => {
    expect(money(4500)).toBe('$45.00')
    expect(money(999_99)).toBe('$999.99')
  })

  it('drops cents above a thousand dollars, where they are noise', () => {
    expect(money(123_456)).toBe('$1,235')
  })

  it('renders a dash when there is no price', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
  })
})

describe('pct', () => {
  it('signs positive moves', () => {
    expect(pct(12.34)).toBe('+12.3%')
  })

  it('keeps negative moves signed by the number itself', () => {
    expect(pct(-4.56)).toBe('-4.6%')
  })

  it('renders a dash when a window has no data', () => {
    expect(pct(null)).toBe('—')
  })
})

describe('heat', () => {
  it('separates falling, flat and rising bands', () => {
    const cold = heat(-15)
    const flat = heat(0)
    const blaze = heat(40)
    expect(new Set([cold, flat, blaze]).size).toBe(3)
  })

  it('treats a missing value as flat rather than falling', () => {
    expect(heat(null)).toBe(heat(0))
  })

  it('gives the same colour to the same band', () => {
    expect(heat(3)).toBe(heat(7))
    expect(heat(9)).not.toBe(heat(3))
  })
})

describe('headlinePrice', () => {
  it('prefers complete-in-box, the collector reference point', () => {
    const got = headlinePrice({
      loose: { median_cents: 4000, n: 9 },
      cib: { median_cents: 9000, n: 6 },
    })
    expect(got).toEqual({ condition: 'cib', cents: 9000 })
  })

  it('falls back to loose when nobody lists a complete copy', () => {
    expect(headlinePrice({ loose: { median_cents: 4000, n: 9 } })).toEqual({
      condition: 'loose',
      cents: 4000,
    })
  })

  it('returns null when there is nothing to show', () => {
    expect(headlinePrice({})).toBeNull()
  })
})

describe('companions', () => {
  it('lists the other priced conditions in shelf order', () => {
    expect(companions({ loose: 4500, cib: 13482, new: 274799 }, 'cib')).toEqual([
      { condition: 'loose', cents: 4500 },
      { condition: 'new', cents: 274799 },
    ])
  })

  it('is empty when the headline is the only price, or the file predates prices', () => {
    expect(companions({ cib: 13482 }, 'cib')).toEqual([])
    expect(companions(undefined, 'cib')).toEqual([])
  })
})

describe('priceMap', () => {
  it('flattens a Prices block to medians', () => {
    expect(priceMap({ loose: { median_cents: 4500, n: 29 }, cib: { median_cents: 13482, n: 36 } })).toEqual({
      loose: 4500,
      cib: 13482,
    })
  })
})

describe('middleHalf', () => {
  it('prints the quartiles as a range', () => {
    expect(middleHalf({ median_cents: 13482, q1_cents: 11000, q3_cents: 17000, n: 36 })).toBe('$110.00–$170.00')
  })

  it('is null when the file carries no quartiles', () => {
    expect(middleHalf({ median_cents: 13482, n: 36 })).toBeNull()
    expect(middleHalf(undefined)).toBeNull()
  })
})

describe('formatDate', () => {
  it('shows a calendar date on the day it names, whatever the local zone', () => {
    expect(formatDate('2026-09-03')).toBe('Sep 3, 2026')
  })

  it('still reads a full timestamp', () => {
    expect(formatDate('2026-09-07T18:51:01Z')).toMatch(/Sep [78], 2026/)
  })

  it('passes through text it cannot parse', () => {
    expect(formatDate('unknown')).toBe('unknown')
  })
})

describe('parseMoney', () => {
  it('reads what a person types for a price, in cents', () => {
    expect(parseMoney('12')).toBe(1200)
    expect(parseMoney('12.5')).toBe(1250)
    expect(parseMoney('$12.50')).toBe(1250)
    expect(parseMoney(' 1,299.99 ')).toBe(129999)
    expect(parseMoney('0')).toBe(0)
  })

  it('accepts a comma as the decimal mark, as a Brazilian keyboard produces', () => {
    expect(parseMoney('12,50')).toBe(1250)
    expect(parseMoney('1.299,99')).toBe(129999)
  })

  it('returns null for nothing, nonsense or a negative amount', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney('12.3456')).toBeNull()
    expect(parseMoney('1.234,567')).toBeNull()
  })

  it('reads a lone mark before exactly three digits as a thousands separator', () => {
    expect(parseMoney('12.345')).toBe(1234500)
    expect(parseMoney('1,299')).toBe(129900)
    expect(parseMoney('.5')).toBe(50)
  })
})

describe('signedMoney', () => {
  it('always shows the direction of a gain or loss', () => {
    expect(signedMoney(1234)).toBe('+$12.34')
    expect(signedMoney(-1234)).toBe('-$12.34')
    expect(signedMoney(0)).toBe('$0.00')
    expect(signedMoney(null)).toBe('—')
  })

  it('keeps the cents above a thousand dollars, unlike a board price', () => {
    expect(signedMoney(123456)).toBe('+$1,234.56')
    expect(moneyExact(100040)).toBe('$1,000.40')
    expect(money(100040)).toBe('$1,000')
  })
})
