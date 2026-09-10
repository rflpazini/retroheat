import { describe, expect, it } from 'vitest'
import type { CollectionItem } from './shelf'
import { collectionTimeline } from './timeline'
import type { HistoryPoint } from './types'

const point = (d: string, prices: { loose?: number | null; cib?: number | null; new?: number | null }, v = 2): HistoryPoint => ({
  d,
  r: 'd',
  loose: prices.loose ?? null,
  cib: prices.cib ?? null,
  new: prices.new ?? null,
  nl: 0,
  nc: 0,
  nn: 0,
  v,
})
const owned = (game_id: string, condition: CollectionItem['condition'], paid_cents: number | null = null): CollectionItem => ({
  game_id,
  condition,
  added_at: '2026-09-07T00:00:00Z',
  paid_cents,
})

describe('collectionTimeline', () => {
  it('adds each copy at its own condition and carries the last price across a day without one', () => {
    const histories = new Map<string, HistoryPoint[]>([
      ['a', [point('2026-09-01', { loose: 1000, cib: 3000 }), point('2026-09-02', { loose: 1100 }), point('2026-09-03', { loose: 1200 })]],
      ['b', [point('2026-09-01', { cib: 5000 }), point('2026-09-03', { cib: 5500 })]],
    ])
    const t = collectionTimeline([owned('a', 'loose'), owned('b', 'cib')], histories)
    expect(t.points).toEqual([
      { date: '2026-09-01', value_cents: 6000 },
      { date: '2026-09-02', value_cents: 6100 },
      { date: '2026-09-03', value_cents: 6700 },
    ])
    expect(t.priced).toBe(2)
    expect(t.total).toBe(2)
  })

  it('starts the line on the first day every copy has a price, so a move is a price move and not a copy joining', () => {
    const histories = new Map<string, HistoryPoint[]>([
      ['a', [point('2026-09-01', { loose: 1000 }), point('2026-09-02', { loose: 1000 }), point('2026-09-03', { loose: 1100 })]],
      ['b', [point('2026-09-02', { cib: 4000 })]],
    ])
    const t = collectionTimeline([owned('a', 'loose'), owned('b', 'cib')], histories)
    expect(t.points).toEqual([
      { date: '2026-09-02', value_cents: 5000 },
      { date: '2026-09-03', value_cents: 5100 },
    ])
  })

  it('leaves out a copy with no history, or none at its condition, and says so in the counts', () => {
    const histories = new Map<string, HistoryPoint[]>([['a', [point('2026-09-01', { loose: 1000 })]]])
    const t = collectionTimeline([owned('a', 'loose'), owned('a-sealed', 'new'), owned('gone', 'cib')], histories)
    expect(t.points).toEqual([{ date: '2026-09-01', value_cents: 1000 }])
    expect(t.priced).toBe(1)
    expect(t.total).toBe(3)
  })

  it('uses only the newest classifier series of each game', () => {
    const histories = new Map<string, HistoryPoint[]>([
      ['a', [point('2026-09-01', { cib: 900 }, 1), point('2026-09-02', { cib: 950 }, 1), point('2026-09-03', { cib: 3000 }, 2)]],
    ])
    const t = collectionTimeline([owned('a', 'cib')], histories)
    expect(t.points).toEqual([{ date: '2026-09-03', value_cents: 3000 }])
  })

  it('sums what was paid over the copies on the line only, so the rule matches the line it is drawn against', () => {
    const histories = new Map<string, HistoryPoint[]>([
      ['a', [point('2026-09-01', { cib: 2000 })]],
      ['c', [point('2026-09-01', { loose: 500 })]],
    ])
    const t = collectionTimeline(
      [owned('a', 'cib', 1000), owned('b', 'cib', 9999), owned('c', 'loose', 250), owned('d', 'loose')],
      histories,
    )
    expect(t.paid_cents).toBe(1250)
    expect(t.paid_covers).toBe(2)
    expect(t.priced).toBe(2)
    expect(collectionTimeline([owned('a', 'cib', 1000)], new Map()).points).toEqual([])
  })
})
