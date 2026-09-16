import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountProvider } from '../lib/account'
import { resetCache } from '../lib/data'
import { COLLECTION_HEADER } from '../lib/export'
import { money, moneyExact, signedMoney } from '../lib/format'
import type { ShelfBackend } from '../lib/shelf'
import { memoryBackend, testUser } from '../lib/shelf-memory'
import type { LatestFile, TrendingFile } from '../lib/types'
import { Collection } from './Collection'
import { Saved } from './Saved'
import { AppShell as AppShellLazy } from '../components/AppShell'

const dataDir = path.resolve(__dirname, '../../../data')
const present = fs.existsSync(path.join(dataDir, 'meta.json'))

function serveLocalData() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) return new Response('{}', { status: 404 })
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

// A board with a handful of rows exercises the row controls the same way as
// the full 180-row board, without the DOM weight that made the click time out
// on the CI runner.
function serveTrimmedBoard(platform: string, keep: string[]) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) return new Response('{}', { status: 404 })
    if (rel === `latest/${platform}.json`) {
      const board = JSON.parse(fs.readFileSync(file, 'utf8')) as LatestFile
      board.games = board.games.filter((g) => keep.includes(g.id))
      return new Response(JSON.stringify(board), { status: 200 })
    }
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

// No backend argument renders without a provider, which is what a build
// without Supabase does; null-free backends render inside one.
function renderAt(route: string, element: React.ReactNode, pattern: string, backend?: ShelfBackend) {
  const routes = (
    <Routes>
      <Route path={pattern} element={element} />
    </Routes>
  )
  return render(
    <MemoryRouter initialEntries={[route]}>
      {backend ? <AccountProvider backend={() => Promise.resolve(backend)}>{routes}</AccountProvider> : routes}
    </MemoryRouter>,
  )
}

describe('the shelf pages explain themselves', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
  })

  it('say accounts are not enabled when Supabase is not configured', () => {
    renderAt('/collection', <Collection />, '/collection')
    expect(document.body.textContent).toMatch(/accounts are not enabled/i)
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
  })

  it('ask to sign in when signed out', async () => {
    const { backend } = memoryBackend({ user: null })
    renderAt('/saved', <Saved />, '/saved', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/sign in to see your saved games/i))
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined()
  })

  it('show the empty state for a signed-in visitor with nothing on the shelf', async () => {
    const { backend } = memoryBackend({ user: testUser })
    renderAt('/collection', <Collection />, '/collection', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/nothing on the shelf yet/i))
  })
})

describe.skipIf(!present)('the shelf pages against real collector output', () => {
  const ps2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest/ps2.json'), 'utf8')) as LatestFile
  const priced = ps2.games.find((g) => g.prices.cib && g.prices.loose)

  beforeEach(() => {
    resetCache()
    serveLocalData()
  })

  it('keeps the whole shelf in one window that scrolls on its own, with the add field on its header strip', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1000 },
        { game_id: priced.id, condition: 'cib', added_at: '2026-09-08T00:00:00Z' },
        { game_id: 'jet-force-gemini-n64', condition: 'loose', added_at: '2026-09-01T00:00:00Z', paid_cents: 500, sold_cents: 900, sold_on: '2026-09-10' },
      ],
    })
    renderAt('/collection', <Collection />, '/collection', backend)

    // One pane holds the table and the sold copies; a scroll bar you cannot reach from the keyboard is scenery.
    const pane = await screen.findByRole('region', { name: /^my collection$/i })
    expect(pane.tabIndex).toBe(0)
    // The shelf table and the sold table, both inside the one pane.
    expect(within(pane).getAllByRole('table')).toHaveLength(2)
    expect(within(pane).getByRole('region', { name: /^sold$/i })).toBeDefined()
    // The add field sits on the window's header strip, not in a window of its own.
    const titles = [...document.querySelectorAll('.window-title-text')].map((el) => el.textContent?.trim())
    expect(titles).toContain('My collection')
    expect(titles).not.toContain('Add a game you own')
    expect(titles).not.toContain('Shelf')
    expect(screen.getByLabelText(/add a game you own/i)).toBeDefined()
    expect(pane.contains(screen.getByLabelText(/add a game you own/i))).toBe(false)
  })

  it('sums the shelf up in one About window: value, gain and the platform bars', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1000 }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const about = await screen.findByRole('region', { name: /about this shelf/i })
    expect(about.textContent).toMatch(/shelf value/i)
    expect(about.textContent).toContain(money(priced.prices.loose!.median_cents))
    expect(about.textContent).toContain(signedMoney(priced.prices.loose!.median_cents - 1000))
    const bars = within(about).getByRole('region', { name: /shelf by platform/i })
    expect(within(bars).getAllByRole('img')).toHaveLength(1)
    // Value and bars are one window, not two.
    const titles = [...document.querySelectorAll('.window-title-text')].map((el) => el.textContent?.trim())
    expect(titles.filter((t) => /shelf by platform|shelf value$/i.test(t ?? ''))).toEqual([])
  })

  it('totals the shelf at the condition of each copy', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)

    await waitFor(() => expect(document.body.textContent).toMatch(/shelf value/i))
    expect(document.body.textContent).toContain(priced.title)
    expect(document.body.textContent).toContain(money(priced.prices.loose!.median_cents))
    expect(document.body.textContent).toMatch(/1 game · 1 priced · 0 unpriced/)
    expect(document.body.textContent).toMatch(/asking prices, not appraisals/i)
  })

  it('changes the condition of a copy from the shelf', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    // The row's own menu names the copy's condition, and reopens on it.
    const own = await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') })
    await user.click(own)
    await user.click(await screen.findByRole('menuitemradio', { name: /complete/i }))
    await waitFor(() => expect(state.copyOf(priced.id)?.condition).toBe('cib'))
    expect(document.body.textContent).toContain(money(priced.prices.cib!.median_cents))
    expect(screen.getByRole('button', { name: ownAs(priced.title, 'Complete') })).toBeDefined()
  })

  it('removes a copy from the shelf through the same menu', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'cib', added_at: '2026-09-07T00:00:00Z' }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Complete') }))
    await user.click(await screen.findByRole('menuitem', { name: /remove this copy/i }))
    await waitFor(() => expect(document.body.textContent).toMatch(/nothing on the shelf yet/i))
    expect(state.collection.size).toBe(0)
    // The row that held the menu is gone, so focus lands on the page region, not on <body>.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: /your collection/i })))
  })

  it('moves focus to the next row when a copy is removed from a longer shelf', async () => {
    if (!priced) return
    const other = ps2.games.find((g) => g.id !== priced.id && g.prices.loose)
    if (!other) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' },
        { game_id: other.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' },
      ],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    // Rows are sorted by price, so remove whichever comes first and expect the survivor.
    const table = (await screen.findByRole('table')) as HTMLTableElement
    const firstTitle = table.tBodies[0].rows[0].querySelector('a')!.textContent!
    const survivor = firstTitle === priced.title ? other : priced
    await user.click(screen.getByRole('button', { name: ownAs(firstTitle, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: /remove this copy/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: ownAs(firstTitle, 'Loose') })).toBeNull())
    // The movers window may name the survivor too, so look for the link in the table.
    await waitFor(() => expect(document.activeElement).toBe(within(table).getByRole('link', { name: survivor.title })))
  })

  it('charts the shelf over time and counts the copies with a history', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 100 },
        // A copy the collector no longer tracks: its history file is a 404 and must not sink the line.
        { game_id: 'vanished-ps2', condition: 'cib', added_at: '2026-09-07T00:00:00Z' },
      ],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/shelf value over time/i))
    await waitFor(() => expect(document.body.textContent).toMatch(/1 of 2 copies have a price history/i))
    expect(document.body.textContent).toMatch(/the paid line covers 1 of those 1/i)
    // The history has more than one day, so the line has a start and today's figure.
    const history = JSON.parse(fs.readFileSync(path.join(dataDir, `history/${priced.id}.json`), 'utf8')) as { points: { d: string }[] }
    if (history.points.length >= 2) {
      expect(document.body.textContent).toMatch(/since /i)
      expect(document.body.textContent).toContain(money(priced.prices.loose!.median_cents))
    }
  })

  it('says so when no history at all could be loaded, instead of calling the shelf new', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    // Everything but the history files loads as usual.
    const serve = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).includes('/data/history/') ? new Response('down', { status: 503 }) : serve(input),
    )
    renderAt('/collection', <Collection />, '/collection', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/price history could not be loaded/i))
    expect(document.body.textContent).not.toMatch(/draws itself as days go by/i)
  })

  it('records what was paid for a copy and shows the gain against today', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    const field = await screen.findByRole('textbox', { name: paidFor(priced.title) })
    const today = priced.prices.loose!.median_cents
    const paid = Math.round(today / 2)
    await user.type(field, `${(paid / 100).toFixed(2)}{Enter}`)
    await waitFor(() => expect(state.copyOf(priced.id)?.paid_cents).toBe(paid))

    // The line and the summary both compare today's asking price with what was paid.
    await waitFor(() => expect(document.body.textContent).toContain(signedMoney(today - paid)))
    expect(document.body.textContent).toMatch(/1 of 1 compared/i)
    expect(document.body.textContent).toContain(money(paid))
  })

  it('keeps the paid price when the condition changes, and clears it when the field is emptied', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1234 }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    const field = (await screen.findByRole('textbox', { name: paidFor(priced.title) })) as HTMLInputElement
    expect(field.value).toBe('12.34')

    await user.click(screen.getByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitemradio', { name: /complete/i }))
    await waitFor(() => expect(state.copyOf(priced.id)?.condition).toBe('cib'))
    expect(state.copyOf(priced.id)?.paid_cents).toBe(1234)
    expect((screen.getByRole('textbox', { name: paidFor(priced.title) }) as HTMLInputElement).value).toBe('12.34')

    await user.clear(field)
    await user.tab()
    await waitFor(() => expect(state.copyOf(priced.id)?.paid_cents).toBeNull())
  })

  it('puts back the stored paid price when the typed value is not a price', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1234 }],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()
    const field = (await screen.findByRole('textbox', { name: paidFor(priced.title) })) as HTMLInputElement
    await user.clear(field)
    await user.type(field, 'abc{Enter}')
    await waitFor(() => expect(field.value).toBe('12.34'))
    expect(state.copyOf(priced.id)?.paid_cents).toBe(1234)

    // More than the store allows snaps back too, instead of failing on the server.
    await user.clear(field)
    await user.type(field, '2000000{Enter}')
    await waitFor(() => expect(field.value).toBe('12.34'))
    expect(state.copyOf(priced.id)?.paid_cents).toBe(1234)
  })

  it('lets the latest edit win when an earlier save is slow to come back', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    // The first write lands at once but its reply is held back until released.
    const original = backend.updateCopy
    let release: () => void = () => {}
    let held = false
    backend.updateCopy = async (id, patch) => {
      await original(id, patch)
      if (!held) {
        held = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
    }
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()
    const field = (await screen.findByRole('textbox', { name: paidFor(priced.title) })) as HTMLInputElement

    await user.type(field, '10{Enter}')
    await user.clear(field)
    await user.type(field, '20{Enter}')
    await waitFor(() => expect(state.copyOf(priced.id)?.paid_cents).toBe(2000))
    expect(field.value).toBe('20.00')

    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(field.value).toBe('20.00')
    expect(state.copyOf(priced.id)?.paid_cents).toBe(2000)
  })

  it('shows the copies notice and no row controls on a store from before migration 0004', async () => {
    if (!priced) return
    // A store from before 0004 returns rows without an id: the shelf reads, nothing on it can be written.
    const { backend } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1234 }],
      legacy: true,
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/shelf value/i))
    expect(document.body.textContent).toContain(priced.title)
    expect(document.body.textContent).toMatch(/0004_copies\.sql/)
    expect(screen.queryByRole('textbox', { name: paidFor(priced.title) })).toBeNull()
    expect(screen.queryByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeNull()
  })

  it('shows one row per copy with each copy at its own condition', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' },
        { game_id: priced.id, condition: 'cib', added_at: '2026-09-08T00:00:00Z' },
      ],
    })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    await waitFor(() => expect(document.body.textContent).toMatch(/shelf value/i))
    expect(document.body.textContent).toMatch(/2 copies · 1 game/)
    expect(document.body.textContent).toContain(money(priced.prices.loose!.median_cents + priced.prices.cib!.median_cents))
    const loose = screen.getByRole('button', { name: ownAs(priced.title, 'Loose') })
    expect(screen.getByRole('button', { name: ownAs(priced.title, 'Complete') })).toBeDefined()
    expect(document.body.textContent).toMatch(/copy 1 of 2/i)

    // Each row's menu speaks for its own copy.
    await user.click(loose)
    await user.click(await screen.findByRole('menuitemradio', { name: /sealed/i }))
    await waitFor(() => expect(state.copiesOf(priced.id).map((c) => c.condition)).toEqual(['new', 'cib']))

    await user.click(screen.getByRole('button', { name: ownAs(priced.title, 'Sealed') }))
    await user.click(await screen.findByRole('menuitem', { name: /remove this copy/i }))
    await waitFor(() => expect(state.copiesOf(priced.id).map((c) => c.condition)).toEqual(['cib']))
    expect(document.body.textContent).toMatch(/1 game · 1 priced/)
  })

  it('offers another copy from a board row already owned, and names every copy on the key', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderAt('/p/ps2', <Platform />, '/p/:platform', backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: `Add another copy of ${priced.title} as Complete` }))
    await waitFor(() => expect(state.copiesOf(priced.id).map((c) => c.condition)).toEqual(['loose', 'cib']))
    expect(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose, Complete') })).toBeDefined()

    await user.click(screen.getByRole('button', { name: ownAs(priced.title, 'Loose, Complete') }))
    await user.click(await screen.findByRole('menuitem', { name: /remove both copies/i }))
    await waitFor(() => expect(state.collection.size).toBe(0))
    expect(await screen.findByRole('button', { name: ownAs(priced.title) })).toBeDefined()
  })

  it('lists saved games with their price and removes one', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser, saved: [priced.id] })
    renderAt('/saved', <Saved />, '/saved', backend)
    const user = userEvent.setup()

    await waitFor(() => expect(document.body.textContent).toContain(priced.title))
    expect(document.body.textContent).toMatch(/1 saved/)
    // On the saved list the bookmark is pressed; pressing it again lets go.
    const bookmark = screen.getByRole('button', { name: `Save ${priced.title}` })
    expect(bookmark.getAttribute('aria-pressed')).toBe('true')
    await user.click(bookmark)
    await waitFor(() => expect(document.body.textContent).toMatch(/nothing saved yet/i))
    expect(state.saved.size).toBe(0)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: /your saved games/i })))
  })

  it('reports the shelf by platform with a bar per platform and the figures in text', async () => {
    if (!priced) return
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')) as { counts: { per_platform?: Record<string, number> } }
    const { backend } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 100 },
        { game_id: priced.id, condition: 'cib', added_at: '2026-09-08T00:00:00Z' },
        { game_id: 'jet-force-gemini-n64', condition: 'loose', added_at: '2026-09-07T00:00:00Z' },
      ],
    })
    renderAt('/collection', <Collection />, '/collection', backend)

    const report = await screen.findByRole('region', { name: /shelf by platform/i })
    const bars = within(report).getAllByRole('img')
    expect(bars).toHaveLength(2)
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^PS2: \d+% of the shelf/), expect.stringMatching(/^N64: \d+% of the shelf/)]),
    )
    // The figures are printed, not only drawn: copies, tracked games (once meta.json lands), value.
    const ps2Tracked = meta.counts.per_platform?.ps2
    if (ps2Tracked) await waitFor(() => expect(report.textContent).toMatch(new RegExp(`2 copies · 1 of ${ps2Tracked} tracked`)))
    expect(report.textContent).toContain(money(priced.prices.loose!.median_cents + priced.prices.cib!.median_cents))
  })

  it('shows a Target column on Saved, marks a row under target, and counts them in the strip', async () => {
    if (!priced) return
    const headline = priced.prices.cib!.median_cents
    const other = ps2.games.find((g) => g.id !== priced.id && g.prices.cib)
    if (!other) return
    const { backend, state } = memoryBackend({
      user: testUser,
      saved: [
        { game_id: priced.id, created_at: '2026-09-07T00:00:00Z', target_cents: headline + 100 },
        { game_id: other.id, created_at: '2026-09-07T00:00:00Z', target_cents: null },
      ],
    })
    renderAt('/saved', <Saved />, '/saved', backend)
    const user = userEvent.setup()

    await waitFor(() => expect(document.body.textContent).toContain(priced.title))
    expect(document.body.textContent).toMatch(/2 saved · 1 under target/i)
    const row = screen.getByRole('link', { name: priced.title }).closest('tr')!
    expect(row.textContent).toMatch(/under target/i)
    const otherRow = screen.getByRole('link', { name: other.title }).closest('tr')!
    expect(otherRow.textContent).not.toMatch(/under target/i)

    // A target typed into the row is kept, in cents, and read back.
    const field = within(otherRow).getByRole('textbox', { name: targetFor(other.title) }) as HTMLInputElement
    const target = other.prices.cib!.median_cents + 500
    await user.type(field, `${(target / 100).toFixed(2)}{Enter}`)
    await waitFor(() => expect(state.saved.get(other.id)?.target_cents).toBe(target))
    await waitFor(() => expect(document.body.textContent).toMatch(/2 saved · 2 under target/i))

    // Clearing the field forgets the target, and the game stays saved.
    await user.clear(field)
    await user.tab()
    await waitFor(() => expect(state.saved.get(other.id)?.target_cents).toBeNull())
    expect(state.saved.has(other.id)).toBe(true)
  })

  it('hides the Target column when the store has no column for it yet', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: testUser })
    // A store from before migration 0004 returns saved rows without the key at all.
    backend.listSaved = async () => [{ game_id: priced.id, created_at: '2026-09-07T00:00:00Z' }]
    renderAt('/saved', <Saved />, '/saved', backend)
    await waitFor(() => expect(document.body.textContent).toContain(priced.title))
    expect(screen.queryByRole('textbox', { name: targetFor(priced.title) })).toBeNull()
    expect(document.body.textContent).not.toMatch(/under target/i)
  })

  it('the game page saves a game and records the copy owned', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    const { Game } = await import('./Game')
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id', backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^saved$/i }).getAttribute('aria-pressed')).toBe('true'))
    expect(state.saved.has('jet-force-gemini-n64')).toBe(true)

    const group = screen.getByRole('group', { name: /condition owned/i })
    await user.click(within(group).getByRole('button', { name: /complete/i }))
    await waitFor(() => expect(state.copyOf('jet-force-gemini-n64')?.condition).toBe('cib'))
    expect(document.body.textContent).toMatch(/in my collection as/i)
  })

  it('a signed-in visitor saves and marks a game straight from a board row', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderAt('/p/ps2', <Platform />, '/p/:platform', backend)
    const user = userEvent.setup()

    const save = await screen.findByRole('button', { name: `Save ${priced.title}` })
    expect(save.getAttribute('aria-pressed')).toBe('false')
    await user.click(save)
    await waitFor(() => expect(save.getAttribute('aria-pressed')).toBe('true'))
    expect(state.saved.has(priced.id)).toBe(true)

    await user.click(screen.getByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /loose/i }))
    await waitFor(() => expect(state.copyOf(priced.id)?.condition).toBe('loose'))
    // The row now reads the condition back, so a board doubles as a checklist.
    expect(screen.getByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeDefined()
  })

  function renderShell(route: string, routes: React.ReactNode, backend: ShelfBackend) {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <AccountProvider backend={() => Promise.resolve(backend)}>
          <Routes>
            <Route path="/" element={<AppShellLazy />}>
              <Route index element={<p>home page</p>} />
              {routes}
            </Route>
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    )
  }

  it('asks what a copy cost the moment it joins the shelf, shows what it asks today, and saves the answer', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderShell('/p/ps2', <Route path="p/:platform" element={<Platform />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /complete/i }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    await waitFor(() => expect(dialog.textContent).toContain(priced.title))
    await waitFor(() => expect(dialog.textContent).toContain(moneyExact(priced.prices.cib!.median_cents)))
    expect(dialog.textContent).toMatch(/complete copy/i)

    const field = within(dialog).getByRole('textbox', { name: paidFor(priced.title) })
    await waitFor(() => expect(document.activeElement).toBe(field))
    const paid = Math.round(priced.prices.cib!.median_cents / 2)
    await user.type(field, (paid / 100).toFixed(2))
    // The gain is previewed while typing, before anything is saved.
    expect(dialog.textContent).toContain(signedMoney(priced.prices.cib!.median_cents - paid))
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /on the shelf/i })).toBeNull())
    await waitFor(() => expect(state.copyOf(priced.id)?.paid_cents).toBe(paid))
    expect(state.copyOf(priced.id)?.condition).toBe('cib')
  })

  it('lets the window be skipped, keeps the copy, and does not ask again for a change of condition', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderShell('/p/ps2', <Route path="p/:platform" element={<Platform />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /loose/i }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    await user.click(within(dialog).getByRole('button', { name: /skip/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /on the shelf/i })).toBeNull())
    expect(state.copyOf(priced.id)?.condition).toBe('loose')
    expect(state.copyOf(priced.id)?.paid_cents).toBeNull()

    await user.click(screen.getByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitemradio', { name: /sealed/i }))
    await waitFor(() => expect(state.copyOf(priced.id)?.condition).toBe('new'))
    expect(screen.queryByRole('dialog', { name: /on the shelf/i })).toBeNull()
  })

  it('refuses a paid price that is not one, and keeps the window open to fix it', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderShell('/p/ps2', <Route path="p/:platform" element={<Platform />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /complete/i }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    await user.type(within(dialog).getByRole('textbox', { name: paidFor(priced.title) }), 'abc{Enter}')
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/type a price/i)
    expect(screen.getByRole('dialog', { name: /on the shelf/i })).toBeDefined()
    expect(state.copyOf(priced.id)?.paid_cents).toBeNull()
  })

  it('opens the same window from the game page', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    const { Game } = await import('./Game')
    renderShell('/g/jet-force-gemini-n64', <Route path="g/:id" element={<Game />} />, backend)
    const user = userEvent.setup()
    const group = await screen.findByRole('group', { name: /condition owned/i })
    await user.click(within(group).getByRole('button', { name: /loose/i }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    await waitFor(() => expect(dialog.textContent).toMatch(/jet force gemini/i))
    await user.type(within(dialog).getByRole('textbox', { name: /paid for/i }), '15{Enter}')
    await waitFor(() => expect(state.copyOf('jet-force-gemini-n64')?.paid_cents).toBe(1500))
  })

  it('opens the same window from quick-add on the collection page', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/add a game you own/i), 'bully ps2')
    const group = await screen.findByRole('group', { name: /add bully as/i })
    await user.click(within(group).getByRole('button', { name: /complete/i }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    await waitFor(() => expect(dialog.textContent).toMatch(/bully/i))
    await user.type(within(dialog).getByRole('textbox', { name: /paid for/i }), '22{Enter}')
    await waitFor(() => expect(state.copyOf('bully-ps2')?.paid_cents).toBe(2200))
  })

  it('asks what the second copy cost, and leaves the first copy alone', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1000 }],
    })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderShell('/p/ps2', <Route path="p/:platform" element={<Platform />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: `Add another copy of ${priced.title} as Sealed` }))
    const dialog = await screen.findByRole('dialog', { name: /on the shelf/i })
    expect(dialog.textContent).toMatch(/sealed copy/i)
    await user.type(within(dialog).getByRole('textbox', { name: paidFor(priced.title) }), '20{Enter}')
    await waitFor(() => expect(state.copiesOf(priced.id).map((c) => c.paid_cents)).toEqual([1000, 2000]))
  })

  it('opens Info from the row menu and saves the purchase day and notes with Return', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1234 }],
    })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: /get info/i }))
    const dialog = await screen.findByRole('dialog', { name: `${priced.title} Info` })
    expect((within(dialog).getByRole('textbox', { name: /paid, in dollars/i }) as HTMLInputElement).value).toBe('12.34')
    await user.type(within(dialog).getByRole('textbox', { name: /acquired on/i }), '2024-10-08')
    await user.type(within(dialog).getByRole('textbox', { name: /^notes$/i }), 'Flea market find{Enter}')
    // Return in the notes makes a new line; the default button saves.
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /info/i })).toBeNull())
    await waitFor(() => expect(state.copyOf(priced.id)?.acquired_on).toBe('2024-10-08'))
    expect(state.copyOf(priced.id)?.notes).toBe('Flea market find')
    expect(state.copyOf(priced.id)?.paid_cents).toBe(1234)
  })

  it('refuses a day it cannot read and notes over 500 characters, and keeps the window open', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: /get info/i }))
    const dialog = await screen.findByRole('dialog', { name: `${priced.title} Info` })
    await user.type(within(dialog).getByRole('textbox', { name: /acquired on/i }), 'last summer')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/day/i)
    await user.clear(within(dialog).getByRole('textbox', { name: /acquired on/i }))

    const notes = within(dialog).getByRole('textbox', { name: /^notes$/i })
    await user.click(notes)
    await user.paste('x'.repeat(501))
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/500/)
    expect(screen.getByRole('dialog', { name: `${priced.title} Info` })).toBeDefined()
    expect(state.copyOf(priced.id)?.notes ?? null).toBeNull()
  })

  it('marks a copy sold and moves it to the Sold window with its realized gain', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1234 }],
    })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') }))
    await user.click(await screen.findByRole('menuitem', { name: /mark as sold/i }))
    const dialog = await screen.findByRole('dialog', { name: `${priced.title} Info` })
    expect(within(dialog).getByRole('checkbox', { name: /^sold$/i }).getAttribute('aria-checked')).toBe('true')
    await user.type(within(dialog).getByRole('textbox', { name: /sold for, in dollars/i }), '20')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(state.copyOf(priced.id)).toBeUndefined())
    const sold = [...state.collection.values()][0]
    expect(sold.sold_cents).toBe(2000)
    expect(sold.sold_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The copy left the shelf table and shows under Sold with what it made.
    await waitFor(() => expect(screen.queryByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeNull())
    const soldWindow = screen.getByRole('region', { name: /sold/i })
    expect(soldWindow.textContent).toContain(priced.title)
    expect(soldWindow.textContent).toContain(signedMoney(2000 - 1234))
    expect(document.body.textContent).toMatch(/nothing on the shelf/i)
  })

  it('puts a sold copy back on the shelf from its Info window', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [
        { game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1000, sold_cents: 1500, sold_on: '2026-09-10' },
      ],
    })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()

    const soldWindow = await screen.findByRole('region', { name: /sold/i })
    expect(soldWindow.textContent).toContain(signedMoney(500))
    await user.click(within(soldWindow).getByRole('button', { name: `Info on ${priced.title}` }))
    const dialog = await screen.findByRole('dialog', { name: `${priced.title} Info` })
    await user.click(within(dialog).getByRole('checkbox', { name: /^sold$/i }))
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(state.copyOf(priced.id)?.sold_on ?? null).toBeNull())
    expect(state.copyOf(priced.id)?.sold_cents ?? null).toBeNull()
    expect(await screen.findByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeDefined()
  })

  it('exports the collection from the File menu as a dated CSV download', async () => {
    if (!priced) return
    const { backend } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z', paid_cents: 1250 }],
    })
    const blobs: Blob[] = []
    const names: string[] = []
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blobs.push(b as Blob)
      return 'blob:shelf'
    }
    URL.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: /account menu/i })

    await user.click(screen.getByRole('button', { name: 'File' }))
    await user.click(await screen.findByRole('menuitem', { name: /export collection/i }))
    await waitFor(() => expect(names).toHaveLength(1))
    expect(names[0]).toMatch(/^retroheat-collection-\d{4}-\d{2}-\d{2}\.csv$/)
    // jsdom's Blob has no text(); a FileReader reads it the old way.
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blobs[0])
    })
    expect(text.split('\r\n')[0]).toBe(COLLECTION_HEADER.join(','))
    expect(text).toContain(priced.id)
    expect(text).toContain(',loose,12.50,')
    click.mockRestore()
  })

  it('imports a GAMEYE file: says what comes in, what needs a pick and what is skipped, then adds the copies', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: /account menu/i })

    await user.click(screen.getByRole('button', { name: 'File' }))
    await user.click(await screen.findByRole('menuitem', { name: /import collection/i }))
    const dialog = await screen.findByRole('dialog', { name: /import collection/i })
    const csv = fs.readFileSync(path.resolve(__dirname, '../lib/fixtures/gameye-collection.csv'), 'utf8')
    await user.upload(within(dialog).getByLabelText(/collection file/i), new File([csv], 'gameye.csv', { type: 'text/csv' }))

    await waitFor(() => expect(dialog.textContent).toMatch(/3 to import/i))
    expect(dialog.textContent).toMatch(/1 needs a pick/i)
    expect(dialog.textContent).toMatch(/3 skipped/i)
    expect(dialog.textContent).toMatch(/Sega Saturn/)
    expect(dialog.textContent).toMatch(/not a game/i)

    // The pick: "Silent Hill" on PS2 could be three games; choosing one brings it in.
    await user.click(within(dialog).getByRole('button', { name: 'Pick Silent Hill 2' }))
    await waitFor(() => expect(dialog.textContent).toMatch(/4 to import/i))

    await user.click(within(dialog).getByRole('button', { name: /import 4 copies/i }))
    await waitFor(() => expect(state.collection.size).toBe(4))
    expect(state.copyOf('bully-ps2')).toMatchObject({ condition: 'cib', paid_cents: 1850, notes: 'Black label' })
    expect(state.copyOf('metroid-fusion-gba')?.condition).toBe('loose')
    expect(state.copyOf('jet-force-gemini-n64')?.condition).toBe('new')
    expect(state.copyOf('silent-hill-2-ps2')).toMatchObject({ condition: 'loose', paid_cents: 1200 })
    expect((await within(dialog).findByRole('status')).textContent).toMatch(/imported 4 copies/i)
    // The shelf behind the window already shows them.
    expect(document.body.textContent).toMatch(/4 games/i)
  })

  it('opens Sharing from the account menu, shows the link once public, and saves the choices', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderShell('/collection', <Route path="collection" element={<Collection />} />, backend)
    // user-event installs a clipboard of its own; the copy is read back from it.
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /account menu/i }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /sharing/i }))
    const dialog = await screen.findByRole('dialog', { name: /sharing/i })
    expect(dialog.textContent).toMatch(/private/i)
    expect(within(dialog).queryByRole('button', { name: /^copy$/i })).toBeNull()

    await user.type(within(dialog).getByRole('textbox', { name: /shelf name/i }), 'Rafa Shelf')
    // The name is made link-safe as it is typed.
    expect((within(dialog).getByRole('textbox', { name: /shelf name/i }) as HTMLInputElement).value).toBe('rafa-shelf')
    await user.click(within(dialog).getByRole('checkbox', { name: /anyone with the link/i }))
    expect(dialog.textContent).toContain('#/u/rafa-shelf')
    await user.click(within(dialog).getByRole('button', { name: /^copy$/i }))
    expect((await within(dialog).findByRole('status')).textContent).toMatch(/copied/i)
    expect(await navigator.clipboard.readText()).toContain('#/u/rafa-shelf')

    await user.click(within(dialog).getByRole('checkbox', { name: /include what i paid/i }))
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /sharing/i })).toBeNull())
    expect(state.profile).toEqual({ slug: 'rafa-shelf', is_public: true, share_paid: true })
  })

  it('never opens the window when the add itself failed', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: testUser })
    backend.addCopy = async () => {
      throw new Error('new row violates row-level security policy')
    }
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderShell('/p/ps2', <Route path="p/:platform" element={<Platform />} />, backend)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /complete/i }))
    await screen.findByRole('alert')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('dialog', { name: /on the shelf/i })).toBeNull()
  })

  it('reports a failed shelf write on the status strip and rolls the row back', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: testUser })
    backend.addCopy = async () => {
      throw new Error('new row violates row-level security policy')
    }
    const { Platform } = await import('./Platform')
    const { AppShell } = await import('../components/AppShell')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    render(
      <MemoryRouter initialEntries={['/p/ps2']}>
        <AccountProvider backend={() => Promise.resolve(backend)}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>home page</p>} />
              <Route path="p/:platform" element={<Platform />} />
            </Route>
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: ownAs(priced.title) }))
    await user.click(await screen.findByRole('menuitemradio', { name: /loose/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/your shelf was not saved: new row violates row-level security policy/i)
    // Said once, on the strip: the page itself does not repeat it.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // The optimistic "Loose" is gone again; the key is back to unowned.
    await waitFor(() => expect(screen.getByRole('button', { name: ownAs(priced.title) })).toBeDefined())
    expect(screen.queryByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeNull()

    // Leaving the page hands the strip back to the price caveat.
    await user.click(screen.getAllByRole('link', { name: /trending/i })[0])
    await waitFor(() => expect(screen.getByText('home page')).toBeDefined())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(document.body.textContent).toMatch(/median asking price/i)
  })

  it('a signed-out visitor gets the same two controls on board rows, and both ask to sign in', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: null })
    const { Platform } = await import('./Platform')
    serveTrimmedBoard('ps2', [priced.id, ...ps2.games.slice(0, 4).map((g) => g.id)])
    renderAt('/p/ps2', <Platform />, '/p/:platform', backend)
    expect(await screen.findByRole('button', { name: `Sign in to save ${priced.title}` })).toBeDefined()
    expect(screen.getByRole('button', { name: `Sign in to add ${priced.title} to your collection` })).toBeDefined()
    expect(screen.queryByRole('button', { name: ownAs(priced.title) })).toBeNull()
  })

  it('the trending board gives the shelf its own column for a signed-in visitor', async () => {
    const trending = JSON.parse(fs.readFileSync(path.join(dataDir, 'trending/all.json'), 'utf8')) as TrendingFile
    if (trending.entries.length < 2) return
    const { backend } = memoryBackend({ user: testUser })
    const { Home } = await import('./Home')
    renderAt('/', <Home />, '/', backend)

    // Which entries show depends on the window the board opens on, so count
    // rather than name them: the hero and every row carry the pair, and the
    // header names the column.
    const saves = await screen.findAllByRole('button', { name: /^Save / })
    const owns = screen.getAllByRole('button', { name: /^Own .* as$/ })
    expect(saves.length).toBeGreaterThan(1)
    expect(owns.length).toBe(saves.length)
    expect(screen.getByText('Shelf', { selector: 'span' })).toBeDefined()
  })

  it('the game page invites a signed-out visitor to build a collection, and not a signed-in one', async () => {
    const signedOut = memoryBackend({ user: null })
    const { Game } = await import('./Game')
    const first = renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id', signedOut.backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/building a collection\?/i))
    expect(screen.getByRole('button', { name: /sign in and start saving/i })).toBeDefined()
    first.unmount()

    const signedIn = memoryBackend({ user: testUser })
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id', signedIn.backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/details/i))
    expect(document.body.textContent).not.toMatch(/building a collection\?/i)
  })

  it('quick-add fills the collection from a title search', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderAt('/collection', <Collection />, '/collection', backend)
    const user = userEvent.setup()

    const box = await screen.findByLabelText(/add a game you own/i)
    await user.type(box, 'bully ps2')
    const group = await screen.findByRole('group', { name: /add bully as/i })
    await user.click(within(group).getByRole('button', { name: /loose/i }))

    await waitFor(() => expect(state.copyOf('bully-ps2')?.condition).toBe('loose'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/added bully to your collection/i))
    expect(document.body.textContent).toMatch(/shelf value/i)
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('the game page asks a signed-out visitor to sign in before saving', async () => {
    const { backend } = memoryBackend({ user: null })
    const { Game } = await import('./Game')
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id', backend)
    const save = await screen.findByRole('button', { name: /^save$/i })
    expect(save.getAttribute('aria-pressed')).toBeNull()
    expect(screen.getByRole('button', { name: /i own this/i })).toBeDefined()
  })
})

/** The accessible name of a row's paid-price field. */
function paidFor(title: string): string {
  return `Paid for ${title}, in dollars`
}

/** The accessible name of a saved row's target-price field. */
function targetFor(title: string): string {
  return `Target for ${title}, in dollars`
}

/** The accessible name of a row's own-as menu button, with the condition it currently shows. */
function ownAs(title: string, condition?: string): string {
  return condition ? `Own ${title} as: ${condition}` : `Own ${title} as`
}
