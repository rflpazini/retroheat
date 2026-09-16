import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetCache } from '../lib/data'
import { Home } from './Home'
import { Platform } from './Platform'
import { About } from './About'
import { AppShell } from '../components/AppShell'
import { PLATFORMS, PLATFORM_LABELS } from '../lib/types'

// These render against the collector's real output rather than hand-made
// fixtures, so a change to the emitted JSON shape fails here instead of in
// production.

const dataDir = path.resolve(__dirname, '../../../data')
const present = fs.existsSync(path.join(dataDir, 'meta.json'))

function serveLocalData() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) {
      return new Response('{}', { status: 404 })
    }
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

function renderAt(route: string, element: React.ReactNode, pattern: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

describe.skipIf(!present)('pages render against real collector output', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
  })

  it('the home board shows a ranked mover, or says why there is none yet', async () => {
    const trending = JSON.parse(fs.readFileSync(path.join(dataDir, 'trending/all.json'), 'utf8')) as {
      entries: unknown[]
    }
    renderAt('/', <Home />, '/')
    if (trending.entries.length > 0) {
      // Every entry carries a move in at least one window, and the board
      // opens on the longest window that has one.
      await waitFor(() => expect(document.body.textContent).toMatch(/hottest game on the shelf/i))
      expect(screen.getAllByText(/%/).length).toBeGreaterThan(0)
    } else {
      // Real collection starts with one point per game, so for the first week
      // there is no momentum to rank. The board must say so, not sit empty.
      await waitFor(() => expect(document.body.textContent).toMatch(/No movers yet/i))
      expect(document.body.textContent).toMatch(/price history/i)
    }
  })

  it('opens on the 1 day window while only one-day moves exist', async () => {
    const trending = JSON.parse(fs.readFileSync(path.join(dataDir, 'trending/all.json'), 'utf8')) as {
      entries: { pct_1d: number | null; pct_7d: number | null }[]
    }
    const onlyDay =
      trending.entries.length > 0 &&
      trending.entries.every((e) => e.pct_7d == null) &&
      trending.entries.some((e) => e.pct_1d != null)
    if (!onlyDay) return

    renderAt('/', <Home />, '/')
    await waitFor(() => expect(document.body.textContent).toMatch(/hottest game on the shelf/i))
    expect(screen.getByRole('button', { name: '1 day' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('a platform board renders its games in a table', async () => {
    renderAt('/p/ps2', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
  })

  it('a mover row labels its headline condition and shows the loose price beside it', async () => {
    const trending = JSON.parse(fs.readFileSync(path.join(dataDir, 'trending/all.json'), 'utf8')) as {
      entries: { id: string; title: string; headline_condition: string; prices?: { loose?: number; cib?: number } }[]
    }
    renderAt('/', <Home />, '/')
    await waitFor(() => expect(document.body.textContent).toMatch(/Complete|Loose|Nothing has moved|No .* yet/i))

    const text = document.body.textContent ?? ''
    // A complete-copy headline reads as a mistake to someone who has only seen
    // loose carts; the row must print the loose figure next to it.
    const shown = trending.entries.find(
      (e) => e.headline_condition === 'cib' && e.prices?.loose && text.includes(e.title),
    )
    if (!shown) return // no complete-and-loose mover on today's shelf
    const loose = shown.prices!.loose! / 100
    expect(text).toContain(`Loose $${loose.toFixed(2)}`)
    expect(text).toMatch(/Complete/)
  })

  it('a platform board shows the mode next to the median', async () => {
    renderAt('/p/ps2', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    // Every eBay-priced bucket carries a mode; the board must surface it, not only the median.
    expect(document.body.textContent).toMatch(/mode \$\d/)
  })

  it('a platform board marks the sorted column for assistive technology', async () => {
    renderAt('/p/ps2', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))

    const sorted = document.querySelectorAll('th[aria-sort="descending"], th[aria-sort="ascending"]')
    expect(sorted.length).toBe(1)
  })

  it('an unknown platform explains itself instead of crashing', async () => {
    renderAt('/p/xbox', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.body.textContent).toMatch(/Unknown platform/i))
  })

  it('the about page states that prices are asking prices', async () => {
    render(<About />)
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/asking prices on active listings/i),
    )
    expect(document.body.textContent).toMatch(/not realized sale prices/i)
  })
})

describe.skipIf(!present)('the sample-data notice fails closed', () => {
  beforeEach(() => resetCache())

  it('warns when the data source cannot be read', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }))
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toMatch(/Unverified source/i))
  })

  it('names generated data as sample data', async () => {
    serveLocalData()
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'))
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    if (meta.source === 'fake') {
      await waitFor(() => expect(document.body.textContent).toMatch(/Sample data/i))
    }
  })
})

describe.skipIf(!present)('the shell behaves like an operating system', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
  })

  // The caveat moved from a page footer to the system status strip. It must
  // still be on screen at all times, wherever it lives.
  it('keeps the asking-price caveat permanently visible', async () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toMatch(/asking price/i))
    expect(document.body.textContent).toMatch(/not what\s+copies sold for/i)
  })

  it('says so on the status strip when the browser is offline, with the day the prices are from', async () => {
    const state = { onLine: false }
    vi.stubGlobal('navigator', {
      ...navigator,
      get onLine() {
        return state.onLine
      },
    })
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toMatch(/offline · prices as of/i))
    state.onLine = true
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(document.body.textContent).toMatch(/asking price/i))
    expect(document.body.textContent).not.toMatch(/offline ·/i)
    vi.unstubAllGlobals()
  })

  it('offers Restart on the status strip when a new version is on disk', async () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toMatch(/asking price/i))
    const apply = vi.fn()
    act(() => window.dispatchEvent(new CustomEvent('retroheat:update-ready', { detail: { apply } })))
    const restart = await screen.findByRole('button', { name: /restart/i })
    expect(document.body.textContent).toMatch(/new version on disk/i)
    await userEvent.setup().click(restart)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('opens a File menu whose items actually navigate', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/about']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="about" element={<p>about page</p>} />
            <Route path="p/:platform" element={<p>board page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'File' }))
    await waitFor(() => expect(screen.getByText('Open PlayStation 2')).toBeDefined())
    for (const label of ['Open GameCube', 'Open Dreamcast', 'Open Game Boy Advance', 'Open Trending']) {
      expect(screen.getByText(label)).toBeDefined()
    }

    // A menu that renders but does nothing is scenery, not a menu.
    await user.click(screen.getByText('Open PlayStation 2'))
    await waitFor(() => expect(screen.getByText('board page')).toBeDefined())
  })

  it('opens the About window from the apple menu', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /apple menu/i }))
    await user.click(await screen.findByText(/About This RetroHeat…/))
    await waitFor(() => expect(document.body.textContent).toMatch(/Games tracked/i))
    expect(document.body.textContent).toMatch(/not what copies actually sold for/i)
  })

  it('shows every platform as an openable disk icon', async () => {
    renderAt('/', <Home />, '/')
    await waitFor(() => expect(document.body.textContent).toMatch(/RetroHeat HD/i))

    for (const label of Object.values(PLATFORM_LABELS)) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(document.body.textContent).toMatch(new RegExp(`${PLATFORMS.length} items`, 'i'))
  })
})

describe.skipIf(!present)('the game page explains the game, not just the price', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
  })

  it('shows specs, trivia and why a title costs what it does', async () => {
    const { Game } = await import('./Game')
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id')

    await waitFor(() => expect(document.body.textContent).toMatch(/Jet Force Gemini/))
    await waitFor(() => expect(document.body.textContent).toMatch(/Developer/i))

    const text = document.body.textContent ?? ''
    expect(text).toMatch(/Rare/)
    expect(text).toMatch(/1999/)
    expect(text).toMatch(/Did you know/i)
    expect(text).toMatch(/Why it costs what it costs/i)
  })

  it('shows the mode next to each condition price', async () => {
    const { Game } = await import('./Game')
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id')

    await waitFor(() => expect(document.body.textContent).toMatch(/Jet Force Gemini/))
    await waitFor(() => expect(document.body.textContent).toMatch(/mode \$\d/))
  })

  it('shows the middle half and the listing count behind each price', async () => {
    const latest = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest/n64.json'), 'utf8')) as {
      games: { id: string; prices: Record<string, { q1_cents?: number; q3_cents?: number; n: number } | undefined> }[]
    }
    const withRange = latest.games.find((g) => Object.values(g.prices).some((p) => p?.q1_cents && p?.q3_cents))
    if (!withRange) return // data written before quartiles were recorded

    const { Game } = await import('./Game')
    renderAt(`/g/${withRange.id}`, <Game />, '/g/:id')

    await waitFor(() => expect(document.body.textContent).toMatch(/middle half \$\d/))
    expect(document.body.textContent).toMatch(/\d+ asking prices/)
    expect(document.body.textContent).toMatch(/a quarter of sellers ask less/)
  })

  it('shows the about paragraph with its Wikipedia credit when one is on file', async () => {
    const gamesDir = path.join(dataDir, 'games')
    const details = fs
      .readdirSync(gamesDir)
      .map((f) => JSON.parse(fs.readFileSync(path.join(gamesDir, f), 'utf8')) as { id: string; info?: { about?: string; about_url?: string } })
    const withAbout = details.find((g) => g.info?.about && g.info?.about_url)
    if (!withAbout) return // nothing to assert against until the catalog carries about text

    const { Game } = await import('./Game')
    renderAt(`/g/${withAbout.id}`, <Game />, '/g/:id')

    await waitFor(() => expect(document.body.textContent).toContain(withAbout.info!.about!.slice(0, 40)))
    const credit = screen.getByRole('link', { name: /Wikipedia, CC BY-SA/ })
    expect(credit.getAttribute('href')).toBe(withAbout.info!.about_url)
  })

  it('shows the cover art when a release has one on file', async () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8')) as {
      games: { id: string; title: string; info?: { cover_url?: string } }[]
    }
    const withCover = catalog.games.find((g) => g.info?.cover_url)
    if (!withCover) return // nothing to assert against until the catalog carries covers

    const { Game } = await import('./Game')
    renderAt(`/g/${withCover.id}`, <Game />, '/g/:id')

    const img = await screen.findByRole('img', { name: new RegExp(`${escapeRegExp(withCover.title)} cover art`) })
    expect(img.getAttribute('src')).toBe(withCover.info!.cover_url)
  })

  it('falls back to a phosphor screen when a release has no cover art', async () => {
    const { CRTScreen } = await import('../components/CRTScreen')
    render(<CRTScreen title="Jet Force Gemini" platform="Nintendo 64" year={1999} />)

    // No cover on file, so the CRT must say so rather than render an empty box.
    expect(document.body.textContent).toMatch(/NO COVER ON FILE/i)
    expect(document.querySelector('.crt')).not.toBeNull()
    expect(document.querySelector('.crt img')).toBeNull()
  })
})

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A classifier change starts a new series. The chart must keep the older
// points visible but distinct, and say why, so a reader never takes a rule
// change for a market move.
describe('the game page marks a classifier change', () => {
  function serveSynthetic(points: unknown[]) {
    const files: Record<string, unknown> = {
      'games/x-ps2.json': { id: 'x-ps2', title: 'X', platform: 'ps2', region: 'NTSC-U', variant: 'none' },
      'history/x-ps2.json': { id: 'x-ps2', points },
    }
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
      const body = files[rel]
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response('{}', { status: 404 })
    })
  }
  const point = (d: string, cib: number, v?: number) => ({
    d, r: 'd', loose: null, cib, new: null, nl: 0, nc: 5, nn: 0, ...(v === undefined ? {} : { v }),
  })

  beforeEach(() => resetCache())

  it('draws points from an older classifier as a dashed tail and says so', async () => {
    serveSynthetic([
      point('2026-09-01', 2000),
      point('2026-09-02', 2000),
      point('2026-09-03', 12000, 1),
      point('2026-09-04', 12100, 1),
    ])
    const { Game } = await import('./Game')
    renderAt('/g/x-ps2', <Game />, '/g/:id')
    await waitFor(() => expect(document.body.textContent).toMatch(/older classifier/i))
    expect(document.body.textContent).toMatch(/before Sep 3, 2026/)
  })

  it('says nothing about versions when every point belongs to the same series', async () => {
    serveSynthetic([point('2026-09-03', 12000, 1), point('2026-09-04', 12100, 1)])
    const { Game } = await import('./Game')
    renderAt('/g/x-ps2', <Game />, '/g/:id')
    await waitFor(() => expect(document.body.textContent).toMatch(/details/i))
    expect(document.body.textContent).not.toMatch(/older classifier/i)
  })
})

/*
  The boards live inside a window that scrolls on its own, the way a Finder
  list did, instead of stretching the page. The pane is a named, focusable
  region so a keyboard user can reach it and scroll it.
*/
describe('boards scroll inside their window', () => {
  function serveFiles(files: Record<string, unknown>) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
      const body = files[rel]
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{}', { status: 404 })
    })
  }
  const mover = (i: number) => ({
    id: `game-${i}-ps2`,
    title: `Game ${i}`,
    platform: 'ps2',
    headline_condition: 'cib',
    price_cents: 1000 + i,
    pct_1d: null,
    pct_7d: 40 - i,
    pct_30d: null,
    score: 40 - i,
    spark: [1, 2, 3],
  })

  beforeEach(() => resetCache())

  it('lists every mover the file carries, not a page of them', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => mover(i + 1))
    serveFiles({ 'trending/all.json': { board: 'all', as_of: '2026-09-15', entries } })
    renderAt('/', <Home />, '/')

    const pane = await screen.findByRole('region', { name: /shelf/i })
    // The first mover is the hero; the other 29 are ranked 02 to 30 in the pane.
    await waitFor(() => expect(within(pane).getByText('30')).toBeDefined())
    expect(within(pane).getByText('02')).toBeDefined()
    expect(pane.getAttribute('tabindex')).toBe('0')
  })

  it('picks the platform from a system menu in the shelf window, and keeps it when a board is empty', async () => {
    const user = userEvent.setup()
    serveFiles({
      'trending/all.json': { board: 'all', as_of: '2026-09-15', entries: [mover(1), mover(2), mover(3)] },
      'trending/gba.json': {
        board: 'gba',
        as_of: '2026-09-15',
        entries: [{ ...mover(1), id: 'metroid-fusion-gba', title: 'Metroid Fusion', platform: 'gba' }],
      },
      // No Game Boy file yet: the board was added before the collector ran.
    })
    renderAt('/', <Home />, '/')
    await screen.findByRole('region', { name: /shelf/i })

    // A menu in the window's own chrome, not a form control dropped on the page.
    expect(document.querySelector('select')).toBeNull()
    await user.click(screen.getByRole('button', { name: /platform/i }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Game Boy Advance' }))
    await waitFor(() => expect(document.body.textContent).toMatch(/Metroid Fusion/))

    await user.click(screen.getByRole('button', { name: /platform/i }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Game Boy' }))
    await waitFor(() => expect(document.body.textContent).toMatch(/No prices yet/i))
    // The way back must still be on screen.
    expect(screen.getByRole('button', { name: /platform/i })).toBeDefined()
    expect(screen.getByRole('button', { name: '7 days' })).toBeDefined()
  })

  it('puts a platform board in a named pane too', async () => {
    serveFiles({
      'latest/ps2.json': {
        platform: 'ps2',
        as_of: '2026-09-15',
        source: 'ebay-browse',
        price_kind: 'asking',
        games: [
          {
            id: 'x-ps2', title: 'X', region: 'NTSC-U', variant: 'none', prices: { cib: { median_cents: 1000, n: 5 } },
            pct_1d: null, pct_7d: 2, pct_30d: null, sparks: {}, stale: false, as_of: '2026-09-15',
          },
        ],
      },
    })
    renderAt('/p/ps2', <Platform />, '/p/:platform')

    const pane = await screen.findByRole('region', { name: /board/i })
    expect(within(pane).getByRole('table')).toBeDefined()
    expect(pane.getAttribute('tabindex')).toBe('0')
  })
})

// A board added to the catalog has no prices until the scheduled collector
// has run once. That is a state to explain, not an error to apologise for.
describe('a board that has not been priced yet', () => {
  beforeEach(() => {
    resetCache()
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
  })

  it('says the board is waiting for its first collection', async () => {
    renderAt('/p/gba', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.body.textContent).toMatch(/No prices yet/i))
    expect(document.body.textContent).toMatch(/Game Boy Advance/)
    expect(document.body.textContent).not.toMatch(/Could not load/i)
  })
})

// A collector run limited to some platforms reports how many games it
// priced, while the boards on disk still hold every platform. The shell
// counts what is on disk, not what one run touched.
describe('the shell counts the games on disk, not the last run', () => {
  beforeEach(() => {
    resetCache()
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/data/meta.json')) {
        return new Response(
          JSON.stringify({
            generated_at: '2026-09-16T03:19:55Z',
            source: 'ebay-browse',
            price_kind: 'asking',
            counts: { tracked: 168, ok: 160, stale: 0, failed: 8, per_platform: { ps2: 172, gb: 51 } },
            api_calls_used: 168,
            platforms: ['ps2', 'gb'],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    })
  })

  it('sums the per-platform counts in the header and the status strip', async () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.body.textContent).toMatch(/223 games/))
    expect(document.body.textContent).toMatch(/223 items/)
    expect(document.body.textContent).not.toMatch(/168 games/)
  })
})
