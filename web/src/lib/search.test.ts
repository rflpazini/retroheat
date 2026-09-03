import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fold, parse, rank, rankBoards } from './search'
import type { CatalogFile, Platform } from './types'

function game(title: string, platform: Platform = 'ps2', info: Record<string, unknown> = {}) {
  return { id: `${fold(title).replace(/ /g, '-')}-${platform}`, title, platform, info }
}

const shelf = [
  game('Bully'),
  game('The Ant Bully', 'gamecube'),
  game('Silent Hill 2'),
  game('Silent Hill 3'),
  game('Shadow of the Colossus', 'ps2', { developer: 'Team Ico', publisher: 'Sony Computer Entertainment', year: 2005 }),
  game('Dragon Quest VIII'),
  game('F-Zero X', 'n64'),
  game('Pokémon Snap', 'n64'),
  game('Ys I & II Chronicles', 'psp'),
  game('Skies of Arcadia', 'dreamcast', { developer: 'Overworks', publisher: 'Sega', year: 2000 }),
]

const titles = (q: string) => rank(q, shelf).map((h) => h.item.title)

describe('rank', () => {
  it('puts the exact title first, then titles that merely contain it', () => {
    expect(titles('bully')).toEqual(['Bully', 'The Ant Bully'])
  })

  it('matches from the start of any word, not only the first', () => {
    expect(titles('hill')).toEqual(['Silent Hill 2', 'Silent Hill 3'])
  })

  it('accepts words in any order', () => {
    expect(titles('colossus shadow')[0]).toBe('Shadow of the Colossus')
  })

  it('folds accents so a plain keyboard finds Pokémon', () => {
    expect(titles('pokemon')).toEqual(['Pokémon Snap'])
  })

  it('reads roman numerals as digits and back', () => {
    expect(titles('dragon quest 8')).toEqual(['Dragon Quest VIII'])
    expect(titles('ys 1')).toEqual(['Ys I & II Chronicles'])
    // The letter X in a title is not lost by the numeral alias.
    expect(titles('f-zero x')).toEqual(['F-Zero X'])
  })

  it('answers to initials', () => {
    expect(titles('sotc')).toEqual(['Shadow of the Colossus'])
  })

  it('uses a platform word as a filter rather than text', () => {
    expect(parse('bully ps2')).toEqual({ words: ['bully'], platform: 'ps2' })
    expect(titles('bully gamecube')).toEqual(['The Ant Bully'])
    expect(titles('bully ps2')).toEqual(['Bully'])
    // A platform alone lists that platform's shelf.
    expect(titles('n64')).toEqual(['F-Zero X', 'Pokémon Snap'])
  })

  it('falls back to developer, publisher and year', () => {
    expect(titles('sega')).toEqual(['Skies of Arcadia'])
    expect(titles('2005')).toEqual(['Shadow of the Colossus'])
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(titles('')).toEqual([])
    expect(titles('   ')).toEqual([])
    expect(titles('zzzz')).toEqual([])
  })

  it('honours the limit', () => {
    expect(rank('s', shelf, 2)).toHaveLength(2)
  })
})

describe('rankBoards', () => {
  it('lists every board for an empty query and filters by label or alias', () => {
    expect(rankBoards('').length).toBeGreaterThan(2)
    expect(rankBoards('ps2').map((b) => b.to)).toEqual(['/p/ps2'])
    expect(rankBoards('method').map((b) => b.to)).toEqual(['/about'])
    expect(rankBoards('zzz')).toEqual([])
  })
})

const catalogPath = path.resolve(__dirname, '../../../data/catalog.json')

describe.skipIf(!fs.existsSync(catalogPath))('against the real catalog', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogFile

  it('finds the well-known titles by their common spellings', () => {
    const first = (q: string) => rank(q, catalog.games)[0]?.item.id
    expect(first('bully')).toBe('bully-ps2')
    expect(first('sotc')).toBe('shadow-of-the-colossus-ps2')
    expect(first('dragon quest 8')).toBe('dragon-quest-viii-ps2')
  })

  it('every game can be found by typing its own title', () => {
    for (const g of catalog.games) {
      const ids = rank(g.title, catalog.games).map((h) => h.item.id)
      expect(ids, g.title).toContain(g.id)
    }
  })
})
