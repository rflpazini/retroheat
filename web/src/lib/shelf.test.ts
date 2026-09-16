import { describe, expect, it } from 'vitest'
import { shelfValue, soldSummary, underTarget, type CollectionItem, type SavedGame } from './shelf'
import type { PriceEntry } from './types'

function entry(prices: Partial<Record<'loose' | 'cib' | 'new', number>>, pct7: number | null): PriceEntry {
  return { prices, pct_7d: pct7 }
}

let copies = 0
const owned = (game_id: string, condition: CollectionItem['condition'], paid_cents: number | null = null): CollectionItem => ({
  id: `copy-${++copies}`,
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

  it('names a game once among the movers however many copies of it are on the shelf', () => {
    const v = shelfValue([owned('bully-ps2', 'loose'), owned('bully-ps2', 'cib'), owned('okami-ps2', 'cib')], index)
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
    const before = shelfValue([{ id: 'copy-x', game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-07T00:00:00Z' }], index)
    expect(before.paid_supported).toBe(false)
    expect(shelfValue([], index).paid_supported).toBe(true)
  })

  it('sums two copies of the same game at their own conditions', () => {
    const v = shelfValue([owned('bully-ps2', 'loose'), owned('bully-ps2', 'cib')], index)
    expect(v.total_cents).toBe(1500 + 3000)
    expect(v.priced).toBe(2)
    expect(v.lines.map((l) => l.item.condition)).toEqual(['cib', 'loose'])
  })

  it('leaves sold copies out of the shelf value', () => {
    const sold = { ...owned('okami-ps2', 'new', 1000), sold_cents: 8000, sold_on: '2026-09-10' }
    const v = shelfValue([owned('bully-ps2', 'loose'), sold], index)
    expect(v.total_cents).toBe(1500)
    expect(v.lines).toHaveLength(1)
    expect(v.compared).toBe(0)
  })

  it('reports a store without copy ids, so the page can hold writes until migration 0004', () => {
    expect(shelfValue([owned('bully-ps2', 'loose')], index).copies_supported).toBe(true)
    const legacy = shelfValue([{ game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: null }], index)
    expect(legacy.copies_supported).toBe(false)
    expect(shelfValue([], index).copies_supported).toBe(true)
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

describe('soldSummary', () => {
  const sold = (item: CollectionItem, sold_cents: number | null, sold_on: string): CollectionItem => ({ ...item, sold_cents, sold_on })

  it('sums realized gain over the copies that have both a paid and a sold price, newest sale first', () => {
    const s = soldSummary([
      sold(owned('bully-ps2', 'loose', 1000), 1500, '2026-09-10'),
      sold(owned('okami-ps2', 'cib', 3000), 2000, '2026-09-11'),
      sold(owned('gitaroo-man-ps2', 'loose'), 9000, '2026-09-12'),
      owned('bully-ps2', 'cib'),
    ])
    expect(s.lines.map((l) => l.item.game_id)).toEqual(['gitaroo-man-ps2', 'okami-ps2', 'bully-ps2'])
    expect(s.lines[0].gain_cents).toBeNull()
    expect(s.lines[1].gain_cents).toBe(-1000)
    expect(s.lines[1].gain_pct).toBeCloseTo(-33.33, 1)
    expect(s.compared).toBe(2)
    expect(s.paid_cents).toBe(4000)
    expect(s.sold_cents).toBe(3500)
    expect(s.gain_cents).toBe(-500)
    expect(s.gain_pct).toBe(-12.5)
  })

  it('has no percentage when the copies compared were free, and none at all when nothing was sold', () => {
    const s = soldSummary([sold(owned('bully-ps2', 'loose', 0), 1500, '2026-09-10')])
    expect(s.gain_cents).toBe(1500)
    expect(s.gain_pct).toBeNull()
    expect(soldSummary([owned('bully-ps2', 'loose')]).lines).toEqual([])
  })

  it('lists a sale whose price was forgotten, without comparing it', () => {
    const s = soldSummary([sold(owned('bully-ps2', 'loose', 1000), null, '2026-09-10')])
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0].sold_cents).toBeNull()
    expect(s.compared).toBe(0)
  })
})

describe('underTarget', () => {
  const index = new Map([
    ['bully-ps2', entry({ loose: 1500, cib: 3000 }, 12)],
    ['okami-ps2', entry({ loose: 1000, cib: 2000, new: 9000 }, -4)],
    ['gitaroo-man-ps2', entry({ loose: 8000 }, null)],
  ])
  const saved = (game_id: string, target_cents: number | null | undefined): SavedGame => ({
    game_id,
    created_at: '2026-09-07T00:00:00Z',
    target_cents,
  })

  it('lists the saved games whose headline asking price is at or under the target', () => {
    const hits = underTarget(
      [saved('bully-ps2', 3000), saved('okami-ps2', 1999), saved('gitaroo-man-ps2', 10000), saved('vanished-ps2', 500)],
      index,
    )
    expect(hits.map((h) => h.game_id)).toEqual(['bully-ps2', 'gitaroo-man-ps2'])
    expect(hits[0]).toEqual({ game_id: 'bully-ps2', target_cents: 3000, asking_cents: 3000, condition: 'cib' })
  })

  it('skips saved games without a target, and reports whether the store can hold one', () => {
    expect(underTarget([saved('bully-ps2', null), saved('okami-ps2', undefined)], index)).toEqual([])
  })
})
