import { describe, expect, it } from 'vitest'
import { parseCSV } from './csv'
import { COLLECTION_HEADER, SAVED_HEADER, collectionCSV, exportName, savedCSV } from './export'
import type { CollectionItem, SavedGame } from './shelf'
import type { CatalogGame, PriceEntry } from './types'

const game = (id: string, title: string, platform: CatalogGame['platform']): CatalogGame => ({
  id,
  title,
  platform,
  region: 'NTSC-U',
  variant: 'none',
})
const byId = new Map([
  ['bully-ps2', game('bully-ps2', 'Bully', 'ps2')],
  ['okami-ps2', game('okami-ps2', 'Okami, the wolf', 'ps2')],
  ['metroid-fusion-gba', game('metroid-fusion-gba', 'Metroid Fusion', 'gba')],
])
const index = new Map<string, PriceEntry>([
  ['bully-ps2', { prices: { loose: 1500, cib: 3000 }, pct_7d: null }],
  ['okami-ps2', { prices: { cib: 4599 }, pct_7d: null }],
])

describe('collectionCSV', () => {
  it('writes one row per copy with money in dollars, days as YYYY-MM-DD, and a header the importer knows', () => {
    const items: CollectionItem[] = [
      { id: 'c1', game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1250, acquired_on: '2024-10-08', notes: 'Flea market, "mint"' },
      { id: 'c2', game_id: 'bully-ps2', condition: 'cib', added_at: '2026-09-08T00:00:00Z', paid_cents: null },
      { id: 'c3', game_id: 'okami-ps2', condition: 'cib', added_at: '2026-09-01T00:00:00Z', paid_cents: 1000, sold_cents: 4000, sold_on: '2026-09-12' },
      { id: 'c4', game_id: 'gone-ps2', condition: 'new', added_at: '2026-09-01T00:00:00Z' },
    ]
    const rows = parseCSV(collectionCSV(items, byId, index))
    expect(rows[0]).toEqual(COLLECTION_HEADER)
    expect(rows).toHaveLength(5)
    const bully = rows.find((r) => r[0] === 'c1')!
    expect(bully).toEqual(['c1', 'bully-ps2', 'Bully', 'ps2', 'NTSC-U', 'loose', '12.50', '2024-10-08', '', '', 'Flea market, "mint"', '15.00', '2026-09-07T00:00:00Z'])
    const sold = rows.find((r) => r[0] === 'c3')!
    expect(sold.slice(5, 10)).toEqual(['cib', '10.00', '', '40.00', '2026-09-12'])
    // A game the catalog no longer names still exports, by id, with no price.
    const gone = rows.find((r) => r[0] === 'c4')!
    expect(gone[2]).toBe('gone-ps2')
    expect(gone[11]).toBe('')
  })

  it('orders rows by title, then by the day the copy was added', () => {
    const items: CollectionItem[] = [
      { id: 'c2', game_id: 'okami-ps2', condition: 'cib', added_at: '2026-09-08T00:00:00Z' },
      { id: 'c1', game_id: 'bully-ps2', condition: 'cib', added_at: '2026-09-09T00:00:00Z' },
      { id: 'c0', game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-01T00:00:00Z' },
    ]
    expect(parseCSV(collectionCSV(items, byId, index)).slice(1).map((r) => r[0])).toEqual(['c0', 'c1', 'c2'])
  })
})

describe('savedCSV', () => {
  it('writes saved games with their target and the headline asking price', () => {
    const saved: SavedGame[] = [
      { game_id: 'okami-ps2', created_at: '2026-09-03T00:00:00Z', target_cents: 4000 },
      { game_id: 'metroid-fusion-gba', created_at: '2026-09-02T00:00:00Z', target_cents: null },
    ]
    const rows = parseCSV(savedCSV(saved, byId, index))
    expect(rows[0]).toEqual(SAVED_HEADER)
    expect(rows[1]).toEqual(['metroid-fusion-gba', 'Metroid Fusion', 'gba', '', '', '2026-09-02T00:00:00Z'])
    expect(rows[2]).toEqual(['okami-ps2', 'Okami, the wolf', 'ps2', '40.00', '45.99', '2026-09-03T00:00:00Z'])
  })
})

describe('exportName', () => {
  it('names the file after the list and the day', () => {
    expect(exportName('collection', '2026-09-16')).toBe('retroheat-collection-2026-09-16.csv')
    expect(exportName('saved', '2026-09-16')).toBe('retroheat-saved-2026-09-16.csv')
  })
})
