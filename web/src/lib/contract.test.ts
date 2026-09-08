import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { CatalogFile, GameDetail, HistoryFile, LatestFile, Meta, PriceIndexFile, TrendingFile } from './types'

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
    if ('series_version' in meta) expect(typeof meta.series_version).toBe('number')
    if (meta.counts.per_platform) {
      for (const p of meta.platforms) expect(typeof meta.counts.per_platform[p]).toBe('number')
    }
  })

  it('prices.json indexes every game on a board with medians the shelves can sum', () => {
    const meta = read<Meta>('meta.json')
    const idx = read<PriceIndexFile>('prices.json')
    expect(typeof idx.as_of).toBe('string')
    for (const p of meta.platforms) {
      for (const g of read<LatestFile>(`latest/${p}.json`).games) {
        const e = idx.games[g.id]
        expect(e, `${g.id} missing from prices.json`).toBeDefined()
        for (const c of ['loose', 'cib', 'new'] as const) {
          if (g.prices[c]) expect(e.prices[c]).toBe(g.prices[c]!.median_cents)
          else expect(e.prices[c]).toBeUndefined()
        }
        if (e.pct_7d !== null) expect(typeof e.pct_7d).toBe('number')
      }
    }
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
      // Data written before the one-day window existed lacks the key.
      if ('pct_1d' in g) expect(['number', 'object']).toContain(typeof g.pct_1d)
      for (const c of ['loose', 'cib', 'new'] as const) {
        const price = g.prices[c]
        if (price) {
          expect(typeof price.median_cents).toBe('number')
          expect(typeof price.n).toBe('number')
          // Mode is optional (single-figure providers omit it) but never null.
          if ('mode_cents' in price) expect(typeof price.mode_cents).toBe('number')
          // Each priced condition charts its own column once there is a line
          // to draw. On the first day of real collection a game has one point
          // and no sparkline, so the requirement follows the history.
          const historyFile = path.join(dataDir, 'history', `${g.id}.json`)
          if (fs.existsSync(historyFile)) {
            const points = read<HistoryFile>(`history/${g.id}.json`).points.filter((p) => p[c] != null)
            if (points.length > 1) {
              expect(Array.isArray(g.sparks[c])).toBe(true)
              expect(g.sparks[c]!.length).toBeGreaterThan(1)
            }
          }
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

  it('catalog entries resolve to a game file and a history file', () => {
    const catalog = read<CatalogFile>('catalog.json')
    expect(catalog.games.length).toBeGreaterThan(0)

    const sample = catalog.games[0]
    expect(typeof sample.id).toBe('string')
    expect(typeof sample.platform).toBe('string')
    // The id names the platform; the game page relies on it to fetch in parallel.
    expect(sample.id.endsWith(`-${sample.platform}`)).toBe(true)

    const detail = read<GameDetail>(`games/${sample.id}.json`)
    expect(detail.id).toBe(sample.id)
    expect(typeof detail.ebay_url).toBe('string')

    const history = read<HistoryFile>(`history/${sample.id}.json`)
    expect(history.id).toBe(sample.id)
    for (const p of history.points) {
      expect(typeof p.d).toBe('string')
      expect(['d', 'w']).toContain(p.r)
      if ('v' in p) expect(typeof p.v).toBe('number')
    }
  })

  it('the catalog carries only what a list needs; the rest is in the game files', () => {
    const raw = fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8')
    for (const heavy of ['"about"', '"why"', '"trivia"', '"ebay_url"', '"annotation"']) {
      expect(raw, `catalog.json carries ${heavy}`).not.toContain(heavy)
    }
  })

  it('annotations survive the trip from YAML to the game files', () => {
    const details = read<CatalogFile>('catalog.json').games.map((g) => read<GameDetail>(`games/${g.id}.json`))
    const annotated = details.filter((d) => d.annotation)
    expect(annotated.length).toBeGreaterThan(0)
    for (const d of annotated) {
      expect(d.annotation!.note.length).toBeGreaterThan(0)
      expect(d.annotation!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
    const details = withInfo.map((g) => read<GameDetail>(`games/${g.id}.json`))
    expect(details.some((d) => d.info?.why)).toBe(true)
    expect(details.some((d) => d.info?.trivia)).toBe(true)
  })
})
