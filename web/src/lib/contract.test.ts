import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { CatalogFile, HistoryFile, LatestFile, Meta, TrendingFile } from './types'

// The TypeScript types here are hand-written mirrors of Go structs. Nothing in
// the compiler connects the two, so a field renamed on the Go side would reach
// production as an undefined value. These tests read what the collector
// actually wrote and fail loudly if the contract drifts.

const dataDir = path.resolve(__dirname, '../../../data')
const present = fs.existsSync(path.join(dataDir, 'meta.json'))

function read<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T
}

describe.skipIf(!present)('collector output matches the frontend contract', () => {
  it('meta.json carries the fields the site reads', () => {
    const meta = read<Meta>('meta.json')
    expect(typeof meta.generated_at).toBe('string')
    expect(typeof meta.source).toBe('string')
    expect(typeof meta.price_kind).toBe('string')
    expect(typeof meta.counts.tracked).toBe('number')
    expect(typeof meta.counts.ok).toBe('number')
    expect(typeof meta.counts.stale).toBe('number')
    expect(typeof meta.counts.failed).toBe('number')
    expect(Array.isArray(meta.platforms)).toBe(true)
  })

  it('every platform named in meta has a board', () => {
    const meta = read<Meta>('meta.json')
    for (const p of meta.platforms) {
      expect(fs.existsSync(path.join(dataDir, 'latest', `${p}.json`))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'trending', `${p}.json`))).toBe(true)
    }
  })

  it('board rows expose prices, changes and staleness', () => {
    const meta = read<Meta>('meta.json')
    const board = read<LatestFile>(`latest/${meta.platforms[0]}.json`)

    expect(typeof board.as_of).toBe('string')
    expect(typeof board.source).toBe('string')
    expect(typeof board.price_kind).toBe('string')
    expect(board.games.length).toBeGreaterThan(0)

    for (const g of board.games) {
      expect(typeof g.id).toBe('string')
      expect(typeof g.title).toBe('string')
      expect(typeof g.stale).toBe('boolean')
      expect(typeof g.as_of).toBe('string')
      // Percentages are explicitly nullable until enough history exists.
      expect(['number', 'object']).toContain(typeof g.pct_7d)
      for (const c of ['loose', 'cib', 'new'] as const) {
        const price = g.prices[c]
        if (price) {
          expect(typeof price.median_cents).toBe('number')
          expect(typeof price.n).toBe('number')
          // Each priced condition charts its own column, so it needs a series.
          expect(Array.isArray(g.sparks[c])).toBe(true)
          expect(g.sparks[c]!.length).toBeGreaterThan(1)
        }
      }
    }
  })

  it('trending entries carry everything the board renders', () => {
    const board = read<TrendingFile>('trending/all.json')
    expect(typeof board.as_of).toBe('string')

    for (const e of board.entries) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.title).toBe('string')
      expect(typeof e.platform).toBe('string')
      expect(['loose', 'cib', 'new']).toContain(e.headline_condition)
      expect(typeof e.price_cents).toBe('number')
      expect(typeof e.score).toBe('number')
      expect(Array.isArray(e.spark)).toBe(true)
      if (e.annotation) {
        expect(typeof e.annotation.note).toBe('string')
        expect(typeof e.annotation.date).toBe('string')
      }
    }
  })

  it('catalog entries resolve to a real history file', () => {
    const catalog = read<CatalogFile>('catalog.json')
    expect(catalog.games.length).toBeGreaterThan(0)

    const sample = catalog.games[0]
    expect(typeof sample.id).toBe('string')
    expect(typeof sample.platform).toBe('string')
    expect(typeof sample.ebay_url).toBe('string')

    const history = read<HistoryFile>(`history/${sample.id}.json`)
    expect(history.id).toBe(sample.id)
    for (const p of history.points) {
      expect(typeof p.d).toBe('string')
      expect(['d', 'w']).toContain(p.r)
    }
  })

  it('annotations survive the trip from YAML to the catalog', () => {
    const catalog = read<CatalogFile>('catalog.json')
    const annotated = catalog.games.filter((g) => g.annotation)
    expect(annotated.length).toBeGreaterThan(0)
    for (const g of annotated) {
      expect(g.annotation!.note.length).toBeGreaterThan(0)
      expect(g.annotation!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('titles are written without HTML escaping', () => {
    const raw = fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8')
    expect(raw).not.toContain('\\u0026')
  })
})

describe.skipIf(!present)('editorial content reaches the site', () => {
  it('carries developer, year and a collectibility note for a good share of the catalog', () => {
    const catalog = read<CatalogFile>('catalog.json')
    const withInfo = catalog.games.filter((g) => g.info)
    expect(withInfo.length).toBeGreaterThan(30)

    for (const g of withInfo) {
      if (g.info!.year !== undefined) expect(typeof g.info!.year).toBe('number')
      if (g.info!.cover_url) expect(g.info!.cover_url.startsWith('https://')).toBe(true)
    }
    expect(withInfo.some((g) => g.info!.why)).toBe(true)
    expect(withInfo.some((g) => g.info!.trivia)).toBe(true)
  })
})
