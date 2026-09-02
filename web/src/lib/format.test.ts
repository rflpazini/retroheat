import { describe, expect, it } from 'vitest'
import { headlinePrice, heat, money, pct } from './format'

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
