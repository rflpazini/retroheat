import { describe, expect, it } from 'vitest'
import { shelfValue, type CollectionItem } from './shelf'
import type { PriceEntry } from './types'

function entry(prices: Partial<Record<'loose' | 'cib' | 'new', number>>, pct7: number | null): PriceEntry {
  return { prices, pct_7d: pct7 }
}

const owned = (game_id: string, condition: CollectionItem['condition'], paid_cents: number | null = null): CollectionItem => ({
  game_id,
  condition,
  added_at: '2026-09-07T00:00:00Z',
  paid_cents,
})

describe('shelfValue', () => {
  const index = new Map([
    ['bully-ps2', entry({ loose: 1500, cib: 3000 }, 12)],
    ['okami-ps2', entry({ loose: 1000, cib: 2000, new: 9000 }, -4)],
    ['gitaroo-man-ps2', entry({ loose: 8000 }, null)],
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
    expect(v.lines[0].entry).toBeUndefined()
  })

  it('orders movers by the size of the move, either direction, and skips games without one', () => {
    const v = shelfValue([owned('okami-ps2', 'cib'), owned('bully-ps2', 'cib'), owned('gitaroo-man-ps2', 'loose')], index)
    expect(v.movers.map((l) => l.item.game_id)).toEqual(['bully-ps2', 'okami-ps2'])
  })

  it('compares what was paid with what the copy asks today, per line and in total', () => {
    // bully loose asks 1500, paid 1000: +500 (+50%); okami cib asks 2000, paid 2500: -500 (-20%).
    const v = shelfValue([owned('bully-ps2', 'loose', 1000), owned('okami-ps2', 'cib', 2500)], index)
    const bully = v.lines.find((l) => l.item.game_id === 'bully-ps2')!
    expect(bully.paid_cents).toBe(1000)
    expect(bully.gain_cents).toBe(500)
    expect(bully.gain_pct).toBe(50)
    expect(v.compared).toBe(2)
    expect(v.paid_cents).toBe(3500)
    expect(v.today_cents).toBe(3500)
    expect(v.gain_cents).toBe(0)
    expect(v.gain_pct).toBe(0)
  })

  it('leaves a line without a paid price, or without a price today, out of the comparison', () => {
    const v = shelfValue(
      [owned('bully-ps2', 'loose'), owned('gitaroo-man-ps2', 'cib', 4000), owned('okami-ps2', 'new', 6000)],
      index,
    )
    expect(v.lines.find((l) => l.item.game_id === 'bully-ps2')!.gain_cents).toBeNull()
    expect(v.lines.find((l) => l.item.game_id === 'gitaroo-man-ps2')!.gain_cents).toBeNull()
    expect(v.compared).toBe(1)
    expect(v.paid_cents).toBe(6000)
    expect(v.today_cents).toBe(9000)
    expect(v.gain_cents).toBe(3000)
    expect(v.gain_pct).toBe(50)
  })

  it('reports a store that cannot hold a paid price yet, so the page can hide the field', () => {
    const withColumn = shelfValue([owned('bully-ps2', 'loose')], index)
    expect(withColumn.paid_supported).toBe(true)
    const before = shelfValue([{ game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-07T00:00:00Z' }], index)
    expect(before.paid_supported).toBe(false)
    expect(shelfValue([], index).paid_supported).toBe(true)
  })

  it('has no percentage when the copies compared were free', () => {
    const v = shelfValue([owned('bully-ps2', 'loose', 0)], index)
    expect(v.gain_cents).toBe(1500)
    expect(v.gain_pct).toBeNull()
  })

  it('orders priced lines by value, highest first', () => {
    const v = shelfValue([owned('okami-ps2', 'loose'), owned('gitaroo-man-ps2', 'loose'), owned('bully-ps2', 'cib')], index)
    expect(v.lines.map((l) => l.price_cents)).toEqual([8000, 3000, 1000])
  })
})
