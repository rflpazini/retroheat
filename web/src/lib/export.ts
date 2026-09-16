import { toCSV } from '@/lib/csv'
import { today } from '@/lib/day'
import { headlineFromMap } from '@/lib/format'
import { platformOf } from '@/lib/report'
import type { CollectionItem, SavedGame } from '@/lib/shelf'
import type { CatalogGame, PriceEntry } from '@/lib/types'

/*
  A shelf belongs to its owner, so it leaves as a file anyone can open.
  Money is written in dollars with cents, days as YYYY-MM-DD, and the header
  names are the ones the importer reads back, so an export round-trips.
*/

export const COLLECTION_HEADER = [
  'id',
  'game_id',
  'title',
  'platform',
  'region',
  'condition',
  'paid',
  'acquired_on',
  'sold',
  'sold_on',
  'notes',
  'asking_today',
  'added_at',
]

export const SAVED_HEADER = ['game_id', 'title', 'platform', 'target', 'asking_today', 'saved_at']

const dollars = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2))

/** The collection, one row per copy, by title then by the day the copy was added. */
export function collectionCSV(items: CollectionItem[], byId: Map<string, CatalogGame>, index: Map<string, PriceEntry>): string {
  const titleOf = (id: string) => byId.get(id)?.title ?? id
  const rows = [...items]
    .sort((a, b) => titleOf(a.game_id).localeCompare(titleOf(b.game_id)) || a.added_at.localeCompare(b.added_at))
    .map((item) => {
      const game = byId.get(item.game_id)
      return [
        item.id ?? '',
        item.game_id,
        titleOf(item.game_id),
        game?.platform ?? platformOf(item.game_id) ?? '',
        game?.region ?? '',
        item.condition,
        dollars(item.paid_cents),
        item.acquired_on ?? '',
        dollars(item.sold_cents),
        item.sold_on ?? '',
        item.notes ?? '',
        dollars(index.get(item.game_id)?.prices[item.condition]),
        item.added_at,
      ]
    })
  return toCSV([COLLECTION_HEADER, ...rows])
}

/** The saved games with their targets, by title. */
export function savedCSV(saved: SavedGame[], byId: Map<string, CatalogGame>, index: Map<string, PriceEntry>): string {
  const titleOf = (id: string) => byId.get(id)?.title ?? id
  const rows = [...saved]
    .sort((a, b) => titleOf(a.game_id).localeCompare(titleOf(b.game_id)))
    .map((s) => {
      const game = byId.get(s.game_id)
      return [
        s.game_id,
        titleOf(s.game_id),
        game?.platform ?? platformOf(s.game_id) ?? '',
        dollars(s.target_cents),
        dollars(headlineFromMap(index.get(s.game_id)?.prices)?.cents),
        s.created_at,
      ]
    })
  return toCSV([SAVED_HEADER, ...rows])
}

export function exportName(kind: 'collection' | 'saved', day: string = today()): string {
  return `retroheat-${kind}-${day}.csv`
}

/** Hands a text file to the browser's download path. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
