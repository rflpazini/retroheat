import { describe, expect, it } from 'vitest'
import { shelfValue, type CollectionItem } from './shelf'
import type { LatestGame } from './types'

function game(id: string, title: string, prices: Partial<Record<'loose' | 'cib' | 'new', number>>, pct7: number | null): LatestGame {
  const p: LatestGame['prices'] = {}
  for (const [c, cents] of Object.entries(prices)) p[c as 'loose' | 'cib' | 'new'] = { median_cents: cents, n: 5 }
  return { id, title, region: 'NTSC-U', variant: 'none', prices: p, pct_1d: null, pct_7d: pct7, pct_30d: null, sparks: {}, stale: false, as_of: '2026-09-07' }
}

const owned = (game_id: string, condition: CollectionItem['condition']): CollectionItem => ({ game_id, condition, added_at: '2026-09-07T00:00:00Z' })

describe('shelfValue', () => {
  const index = new Map([
    ['bully-ps2', game('bully-ps2', 'Bully', { loose: 1500, cib: 3000 }, 12)],
    ['okami-ps2', game('okami-ps2', 'Okami', { loose: 1000, cib: 2000, new: 9000 }, -4)],
    ['gitaroo-man-ps2', game('gitaroo-man-ps2', 'Gitaroo Man', { loose: 8000 }, null)],
  ])

  it('sums each copy at the condition owned, not the headline', () => {
    const v = shelfValue([owned('bully-ps2', 'loose'), owned('okami-ps2', 'new')], index)
    expect(v.total_cents).toBe(1500 + 9000)
    expect(v.priced).toBe(2)
    expect(v.unpriced).toBe(0)
  })

  it('counts a copy whose condition has no price as unpriced and lists it last', () => {
    const v = shelfValue([owned('gitaroo-man-ps2', 'cib'), owned('bully-ps2', 'cib')], index)
    expect(v.total_cents).toBe(3000)
    expect(v.unpriced).toBe(1)
    expect(v.lines.map((l) => l.item.game_id)).toEqual(['bully-ps2', 'gitaroo-man-ps2'])
    expect(v.lines[1].price_cents).toBeNull()
  })

  it('ignores games that are no longer on any board', () => {
    const v = shelfValue([owned('vanished-ps2', 'cib')], index)
    expect(v.total_cents).toBe(0)
    expect(v.unpriced).toBe(1)
    expect(v.lines[0].latest).toBeUndefined()
  })

  it('orders movers by the size of the move, either direction, and skips games without one', () => {
    const v = shelfValue([owned('okami-ps2', 'cib'), owned('bully-ps2', 'cib'), owned('gitaroo-man-ps2', 'loose')], index)
    expect(v.movers.map((l) => l.item.game_id)).toEqual(['bully-ps2', 'okami-ps2'])
  })

  it('orders priced lines by value, highest first', () => {
    const v = shelfValue([owned('okami-ps2', 'loose'), owned('gitaroo-man-ps2', 'loose'), owned('bully-ps2', 'cib')], index)
    expect(v.lines.map((l) => l.price_cents)).toEqual([8000, 3000, 1000])
  })
})
