import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetCache } from '../lib/data'
import { Home } from './Home'
import { Platform } from './Platform'
import { About } from './About'
import { AppShell } from '../components/AppShell'

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
      await waitFor(() => expect(document.body.textContent).toMatch(/hottest game on the shelf/i))
      expect(screen.getAllByText(/%/).length).toBeGreaterThan(0)
    } else {
      // Real collection starts with one point per game, so for the first week
      // there is no momentum to rank. The board must say so, not sit empty.
      await waitFor(() => expect(document.body.textContent).toMatch(/No movers yet/i))
      expect(document.body.textContent).toMatch(/week of price history/i)
    }
  })

  it('a platform board renders its games in a table', async () => {
    renderAt('/p/ps2', <Platform />, '/p/:platform')
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
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
    for (const label of ['Open GameCube', 'Open Dreamcast', 'Open Trending']) {
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

    for (const label of ['PlayStation 2', 'GameCube', 'PSP', 'PS Vita', 'Nintendo 64', 'Dreamcast']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(document.body.textContent).toMatch(/6 items/i)
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
