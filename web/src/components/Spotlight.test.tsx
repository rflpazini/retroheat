import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { resetCache } from '../lib/data'
import { AppShell } from './AppShell'

const dataDir = path.resolve(__dirname, '../../../data')
const present = fs.existsSync(path.join(dataDir, 'catalog.json'))

function serveLocalData() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) return new Response('{}', { status: 404 })
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

function GameStub() {
  const { id } = useParams()
  return <p>game page {id}</p>
}

function renderShell(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<p>home page</p>} />
          <Route path="p/:platform" element={<p>board page</p>} />
          <Route path="g/:id" element={<GameStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe.skipIf(!present)('Spotlight search', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
    try {
      sessionStorage.setItem('retroheat-booted', '1')
    } catch {
      // no storage in this environment
    }
  })

  it('opens with Cmd+K, finds a game by title and opens it on Enter', async () => {
    const user = userEvent.setup()
    renderShell()
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox', { name: /search games/i })
    expect(document.activeElement).toBe(input)

    await user.type(input, 'bully')
    await waitFor(() => expect(screen.getByRole('option', { name: /^Bully/ })).toBeDefined())
    // The exact title ranks above the one that merely contains the word.
    const options = screen.getAllByRole('option').filter((o) => o.dataset.kind === 'game')
    expect(options[0].textContent).toMatch(/^Bully/)
    expect(options[0].getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.body.textContent).toMatch(/game page bully-ps2/))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('also opens with Ctrl+K and from the menu bar, and closes on Escape', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /search the shelf/i })).toBeDefined()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: /search games/i }))
    expect(await screen.findByRole('dialog', { name: /search the shelf/i })).toBeDefined()
    // Cmd+K toggles: pressing it again closes the palette.
    await user.keyboard('{Meta>}k{/Meta}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('narrows to a platform when the query names one, and arrows through results', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox', { name: /search games/i })
    await user.type(input, 'pokemon n64')
    await waitFor(() =>
      expect(screen.getAllByRole('option').filter((o) => o.dataset.kind === 'game').length).toBeGreaterThan(0),
    )
    const games = screen.getAllByRole('option').filter((o) => o.dataset.kind === 'game')
    expect(games.every((o) => o.dataset.platform === 'n64')).toBe(true)

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe('spotlight-option-1')
    await user.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('offers the boards with nothing typed and says when no game matches', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox', { name: /search games/i })
    expect(screen.getByRole('option', { name: /PlayStation 2 board/ })).toBeDefined()

    await user.type(input, 'zzzz not a game')
    await waitFor(() => expect(document.body.textContent).toMatch(/No game called/))
    // Boards that do not match the words are gone too, so Enter does nothing surprising.
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('shows the headline price beside a priced game', async () => {
    const user = userEvent.setup()
    renderShell()
    const ps2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'latest/ps2.json'), 'utf8')) as {
      games: { id: string; title: string; prices: Record<string, unknown> }[]
    }
    const priced = ps2.games.find((g) => Object.keys(g.prices).length > 0)
    if (!priced) return

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox', { name: /search games/i })
    await user.type(input, `${priced.title} ps2`)
    await waitFor(() => {
      const first = screen.getAllByRole('option').filter((o) => o.dataset.kind === 'game')[0]
      expect(first?.textContent).toMatch(/\$\d/)
    })
  })
})
