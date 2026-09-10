import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountProvider } from '../lib/account'
import { resetCache } from '../lib/data'
import { money, signedMoney } from '../lib/format'
import type { ShelfBackend } from '../lib/shelf'
import { memoryBackend, testUser } from '../lib/shelf-memory'
import type { LatestFile, TrendingFile } from '../lib/types'
import { Collection } from './Collection'
import { Saved } from './Saved'

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
    await waitFor(() => expect(state.collection.get(priced.id)?.condition).toBe('cib'))
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
    await user.click(await screen.findByRole('menuitem', { name: /remove from collection/i }))
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
    await user.click(await screen.findByRole('menuitem', { name: /remove from collection/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: ownAs(firstTitle, 'Loose') })).toBeNull())
    // The movers window may name the survivor too, so look for the link in the table.
    await waitFor(() => expect(document.activeElement).toBe(within(table).getByRole('link', { name: survivor.title })))
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
    await waitFor(() => expect(state.collection.get(priced.id)?.paid_cents).toBe(paid))

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
    await waitFor(() => expect(state.collection.get(priced.id)?.condition).toBe('cib'))
    expect(state.collection.get(priced.id)?.paid_cents).toBe(1234)
    expect((screen.getByRole('textbox', { name: paidFor(priced.title) }) as HTMLInputElement).value).toBe('12.34')

    await user.clear(field)
    await user.tab()
    await waitFor(() => expect(state.collection.get(priced.id)?.paid_cents).toBeNull())
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
    expect(state.collection.get(priced.id)?.paid_cents).toBe(1234)

    // More than the store allows snaps back too, instead of failing on the server.
    await user.clear(field)
    await user.type(field, '2000000{Enter}')
    await waitFor(() => expect(field.value).toBe('12.34'))
    expect(state.collection.get(priced.id)?.paid_cents).toBe(1234)
  })

  it('lets the latest edit win when an earlier save is slow to come back', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({
      user: testUser,
      collection: [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }],
    })
    // The first write lands at once but its reply is held back until released.
    const original = backend.setPaid
    let release: () => void = () => {}
    let held = false
    backend.setPaid = async (id, cents) => {
      await original(id, cents)
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
    await waitFor(() => expect(state.collection.get(priced.id)?.paid_cents).toBe(2000))
    expect(field.value).toBe('20.00')

    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(field.value).toBe('20.00')
    expect(state.collection.get(priced.id)?.paid_cents).toBe(2000)
  })

  it('hides the paid field when the store has no column for it yet', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: testUser })
    // A store from before migration 0003 returns rows without the key at all.
    backend.listCollection = async () => [{ game_id: priced.id, condition: 'loose', added_at: '2026-09-07T00:00:00Z' }]
    renderAt('/collection', <Collection />, '/collection', backend)
    await waitFor(() => expect(document.body.textContent).toMatch(/shelf value/i))
    expect(screen.queryByRole('textbox', { name: paidFor(priced.title) })).toBeNull()
    expect(document.body.textContent).toMatch(/0003_paid_price\.sql/)
    expect(document.body.textContent).not.toMatch(/\bGain\b/)
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
    await waitFor(() => expect(state.collection.get('jet-force-gemini-n64')?.condition).toBe('cib'))
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
    await waitFor(() => expect(state.collection.get(priced.id)?.condition).toBe('loose'))
    // The row now reads the condition back, so a board doubles as a checklist.
    expect(screen.getByRole('button', { name: ownAs(priced.title, 'Loose') })).toBeDefined()
  })

  it('reports a failed shelf write on the status strip and rolls the row back', async () => {
    if (!priced) return
    const { backend } = memoryBackend({ user: testUser })
    backend.own = async () => {
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

    await waitFor(() => expect(state.collection.get('bully-ps2')?.condition).toBe('loose'))
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

/** The accessible name of a row's own-as menu button, with the condition it currently shows. */
function ownAs(title: string, condition?: string): string {
  return condition ? `Own ${title} as: ${condition}` : `Own ${title} as`
}
