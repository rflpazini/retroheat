import { describe, expect, it } from 'vitest'
import { isPlatform, sortGames } from './Platform'
import type { LatestGame } from '../lib/types'

function game(id: string, over: Partial<LatestGame> = {}): LatestGame {
  return {
    id,
    title: id,
    region: 'NTSC-U',
    variant: 'none',
    prices: {},
    sparks: {},
    pct_1d: null,
    pct_7d: null,
    pct_30d: null,
    stale: false,
    as_of: '2026-09-01',
    ...over,
  }
}

describe('sortGames', () => {
  it('orders by the chosen numeric column', () => {
    const games = [game('a', { pct_7d: 3 }), game('b', { pct_7d: 12 }), game('c', { pct_7d: -4 })]
    expect(sortGames(games, 'pct_7d', true).map((g) => g.id)).toEqual(['b', 'a', 'c'])
    expect(sortGames(games, 'pct_7d', false).map((g) => g.id)).toEqual(['c', 'a', 'b'])
  })

  it('sorts by the one-day move as well', () => {
    const games = [game('a', { pct_1d: 3 }), game('b', { pct_1d: 12 }), game('c')]
    expect(sortGames(games, 'pct_1d', true).map((g) => g.id)).toEqual(['b', 'a', 'c'])
  })

  it('keeps games without a value at the bottom in both directions', () => {
    const games = [game('none'), game('has', { pct_7d: 5 })]
    expect(sortGames(games, 'pct_7d', true).map((g) => g.id)).toEqual(['has', 'none'])
    expect(sortGames(games, 'pct_7d', false).map((g) => g.id)).toEqual(['has', 'none'])
  })

  it('sorts prices by their cent value, not their formatted text', () => {
    const games = [
      game('cheap', { prices: { cib: { median_cents: 900, n: 5 } } }),
      game('dear', { prices: { cib: { median_cents: 120_000, n: 5 } } }),
    ]
    expect(sortGames(games, 'cib', true).map((g) => g.id)).toEqual(['dear', 'cheap'])
  })

  it('sorts titles alphabetically', () => {
    const games = [game('Zelda'), game('Ape Escape')]
    expect(sortGames(games, 'title', false).map((g) => g.id)).toEqual(['Ape Escape', 'Zelda'])
  })

  it('does not mutate the input order', () => {
    const games = [game('a', { pct_7d: 1 }), game('b', { pct_7d: 9 })]
    sortGames(games, 'pct_7d', true)
    expect(games.map((g) => g.id)).toEqual(['a', 'b'])
  })
})

describe('isPlatform', () => {
  it('accepts the six tracked consoles', () => {
    expect(isPlatform('ps2')).toBe(true)
    expect(isPlatform('dreamcast')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isPlatform('xbox')).toBe(false)
    expect(isPlatform(undefined)).toBe(false)
  })
})
