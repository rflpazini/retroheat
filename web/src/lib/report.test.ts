import { describe, expect, it } from 'vitest'
import { shelfByPlatform } from './report'
import type { CollectionItem } from './shelf'
import type { PriceEntry } from './types'

const entry = (prices: Partial<Record<'loose' | 'cib' | 'new', number>>): PriceEntry => ({ prices, pct_7d: null })
let n = 0
const owned = (game_id: string, condition: CollectionItem['condition'], paid_cents: number | null = null): CollectionItem => ({
  id: `copy-${++n}`,
  game_id,
  condition,
  added_at: '2026-09-07T00:00:00Z',
  paid_cents,
})

describe('shelfByPlatform', () => {
  const index = new Map([
    ['bully-ps2', entry({ loose: 1500, cib: 3000 })],
    ['okami-ps2', entry({ cib: 2000 })],
    ['jet-force-gemini-n64', entry({ loose: 5000 })],
    ['metroid-fusion-gba', entry({ new: 10000 })],
  ])
  const tracked = { ps2: 172, n64: 60, gba: 56 }

  it('splits the shelf by platform with copies, tracked count, value share and gain, most valuable first', () => {
    const rows = shelfByPlatform(
      [owned('bully-ps2', 'loose', 1000), owned('bully-ps2', 'cib'), owned('okami-ps2', 'cib', 500), owned('jet-force-gemini-n64', 'loose', 2000)],
      index,
      tracked,
    )
    expect(rows.map((r) => r.platform)).toEqual(['ps2', 'n64'])
    const ps2 = rows[0]
    expect(ps2.copies).toBe(3)
    expect(ps2.games).toBe(2)
    expect(ps2.tracked).toBe(172)
    expect(ps2.value_cents).toBe(1500 + 3000 + 2000)
    expect(ps2.share).toBeCloseTo(6500 / 11500, 5)
    // Gain compares only copies with both numbers: bully loose (+500) and okami (+1500).
    expect(ps2.compared).toBe(2)
    expect(ps2.paid_cents).toBe(1500)
    expect(ps2.gain_cents).toBe(2000)
    expect(rows[1].share).toBeCloseTo(5000 / 11500, 5)
  })

  it('leaves out sold copies and platforms with nothing on the shelf, and copes without a tracked count', () => {
    const rows = shelfByPlatform(
      [owned('metroid-fusion-gba', 'new'), { ...owned('bully-ps2', 'cib'), sold_cents: 1, sold_on: '2026-09-10' }],
      index,
      undefined,
    )
    expect(rows.map((r) => r.platform)).toEqual(['gba'])
    expect(rows[0].tracked).toBeNull()
    expect(rows[0].share).toBe(1)
  })

  it('gives an unpriced platform a share of zero rather than dividing by nothing', () => {
    const rows = shelfByPlatform([owned('vanished-ps2', 'cib')], index, tracked)
    expect(rows).toHaveLength(1)
    expect(rows[0].value_cents).toBe(0)
    expect(rows[0].share).toBe(0)
    expect(rows[0].unpriced).toBe(1)
  })
})
