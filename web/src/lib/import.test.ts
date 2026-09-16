import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCSV } from './csv'
import { COLLECTION_HEADER, collectionCSV } from './export'
import { detectFormat, matchRows, platformNamed, readRows, toCopies } from './import'
import type { CollectionItem } from './shelf'
import type { CatalogGame } from './types'

const game = (id: string, title: string, platform: CatalogGame['platform']): CatalogGame => ({
  id,
  title,
  platform,
  region: 'NTSC-U',
  variant: 'none',
})
const catalog = [
  game('bully-ps2', 'Bully', 'ps2'),
  game('silent-hill-ps2', 'Silent Hill 2', 'ps2'),
  game('silent-hill-3-ps2', 'Silent Hill 3', 'ps2'),
  game('okami-ps2', 'Okami', 'ps2'),
  game('dolce-vita-ps2', 'Dolce Vita', 'ps2'),
  game('dolce-vita-vita', 'Dolce Vita', 'vita'),
  game('metroid-fusion-gba', 'Metroid Fusion', 'gba'),
  game('jet-force-gemini-n64', 'Jet Force Gemini', 'n64'),
]
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

describe('detectFormat', () => {
  it('recognises RetroHeat, GAMEYE and PriceCharting files by their headers', () => {
    expect(detectFormat(COLLECTION_HEADER)).toBe('retroheat')
    expect(detectFormat(parseCSV(fixture('gameye-collection.csv'))[0])).toBe('gameye')
    expect(detectFormat(parseCSV(fixture('pricecharting-collection.csv'))[0])).toBe('pricecharting')
    expect(detectFormat(['Name', 'Year'])).toBeNull()
  })
})

describe('platformNamed', () => {
  it('maps the console names sellers and their tools use, whichever way they spell them', () => {
    expect(platformNamed('PlayStation 2')).toBe('ps2')
    expect(platformNamed('Playstation 2')).toBe('ps2')
    expect(platformNamed('PS2')).toBe('ps2')
    expect(platformNamed('Gamecube')).toBe('gamecube')
    expect(platformNamed('Nintendo GameCube')).toBe('gamecube')
    expect(platformNamed('Nintendo 64')).toBe('n64')
    expect(platformNamed('GameBoy')).toBe('gb')
    expect(platformNamed('Game Boy Color')).toBe('gbc')
    expect(platformNamed('GameBoy Advance')).toBe('gba')
    expect(platformNamed('Sega Dreamcast')).toBe('dreamcast')
    expect(platformNamed('Playstation Vita')).toBe('vita')
    expect(platformNamed('PSP')).toBe('psp')
    expect(platformNamed('Sega Saturn')).toBeNull()
    expect(platformNamed('')).toBeNull()
  })
})

describe('readRows', () => {
  it('reads a GAMEYE export by header name: ownership to condition, "?" and "missing field" as blanks, non-games skipped', () => {
    const records = parseCSV(fixture('gameye-collection.csv'))
    const rows = readRows('gameye', records)
    expect(rows).toHaveLength(7)
    const [bully, metroid, jet, slim, saturn, okami, silentHill] = rows
    expect(bully).toMatchObject({ title: 'Bully', platform: 'ps2', condition: 'cib', paid_cents: 1850, notes: 'Black label' })
    expect(metroid).toMatchObject({ title: 'Metroid Fusion', platform: 'gba', condition: 'loose', paid_cents: null, notes: null })
    expect(jet).toMatchObject({ platform: 'n64', condition: 'new', paid_cents: null })
    expect(slim.skip).toMatch(/not a game/i)
    expect(saturn).toMatchObject({ platform: null })
    expect(saturn.skip).toMatch(/Sega Saturn/)
    expect(okami.skip).toMatch(/manual only/i)
    // A boxed copy without a manual is not complete; it comes in as loose and says so.
    expect(silentHill).toMatchObject({ condition: 'loose', paid_cents: 1200 })
    expect(silentHill.note).toMatch(/boxed/i)
  })

  it('reads a PriceCharting export by header name, with dollar signs on the paid price', () => {
    const rows = readRows('pricecharting', parseCSV(fixture('pricecharting-collection.csv')))
    expect(rows[0]).toMatchObject({ title: 'Bully', platform: 'ps2', condition: 'cib', paid_cents: 1850 })
    expect(rows[1]).toMatchObject({ title: 'Metroid Fusion', platform: 'gba', condition: 'loose', paid_cents: null, notes: 'gift' })
    expect(rows[2]).toMatchObject({ condition: 'new', paid_cents: 2500 })
    expect(rows[3].skip).toMatch(/Super Nintendo/)
  })

  it('reads its own export back by game id, and leaves sold copies where they are', () => {
    const items: CollectionItem[] = [
      { id: 'c1', game_id: 'bully-ps2', condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1250, acquired_on: '2024-10-08', notes: 'hi' },
      { id: 'c2', game_id: 'okami-ps2', condition: 'cib', added_at: '2026-09-01T00:00:00Z', paid_cents: 1000, sold_cents: 4000, sold_on: '2026-09-12' },
    ]
    const byId = new Map(catalog.map((g) => [g.id, g]))
    const rows = readRows('retroheat', parseCSV(collectionCSV(items, byId, new Map())))
    expect(rows[0]).toMatchObject({ game_id: 'bully-ps2', platform: 'ps2', condition: 'loose', paid_cents: 1250, acquired_on: '2024-10-08', notes: 'hi' })
    expect(rows[1].skip).toMatch(/sold/i)
  })
})

describe('matchRows', () => {
  const row = (title: string, platform: CatalogGame['platform'] | null, condition: 'loose' | 'cib' | 'new' = 'cib') => ({
    line: 2,
    title,
    platformName: platform ?? 'Unknown',
    platform,
    condition,
    paid_cents: null,
    acquired_on: null,
    notes: null,
  })

  it('matches a title within its platform, and never lets a platform word in the title change the platform', () => {
    const [ps2, vita] = matchRows([row('Dolce Vita', 'ps2'), row('Dolce Vita', 'vita')], catalog, {})
    expect(ps2).toMatchObject({ kind: 'match', game: { id: 'dolce-vita-ps2' } })
    expect(vita).toMatchObject({ kind: 'match', game: { id: 'dolce-vita-vita' } })
  })

  it('asks for a pick when the best match is weak or two games tie, and skips what the catalog does not track', () => {
    const [weak, tie, none] = matchRows([row('Silent', 'ps2'), row('Silent Hill', 'ps2'), row('Shadow of the Colossus', 'ps2')], catalog, {})
    expect(weak.kind).toBe('pick')
    expect(tie.kind).toBe('pick')
    if (tie.kind === 'pick') expect(tie.candidates.map((g) => g.id).sort()).toEqual(['silent-hill-3-ps2', 'silent-hill-ps2'])
    expect(none).toMatchObject({ kind: 'skip' })
    if (none.kind === 'skip') expect(none.reason).toMatch(/not tracked/i)
  })

  it('carries a row already marked to skip, and skips a copy already on the shelf in the same condition when asked to', () => {
    const existing: CollectionItem[] = [{ id: 'c1', game_id: 'bully-ps2', condition: 'cib', added_at: '2026-09-07T00:00:00Z' }]
    const rows = [{ ...row('Bully', 'ps2', 'cib') }, { ...row('Bully', 'ps2', 'loose') }, { ...row('Whatever', null), skip: 'Unknown platform' }]
    const [same, other, marked] = matchRows(rows, catalog, { existing, dedupe: true })
    expect(same).toMatchObject({ kind: 'skip' })
    if (same.kind === 'skip') expect(same.reason).toMatch(/already on the shelf/i)
    expect(other).toMatchObject({ kind: 'match', game: { id: 'bully-ps2' } })
    expect(marked).toMatchObject({ kind: 'skip', reason: 'Unknown platform' })
    // Without dedupe the same copy comes in again.
    expect(matchRows(rows.slice(0, 1), catalog, { existing })[0].kind).toBe('match')
  })

  it('turns the matches into new copies, keeping paid, day and notes', () => {
    const matches = matchRows([{ ...row('Bully', 'ps2', 'loose'), paid_cents: 1250, acquired_on: '2024-10-08', notes: 'hi' }, row('Nope', 'ps2')], catalog, {})
    expect(toCopies(matches)).toEqual([{ game_id: 'bully-ps2', condition: 'loose', paid_cents: 1250, acquired_on: '2024-10-08', notes: 'hi' }])
  })
})
