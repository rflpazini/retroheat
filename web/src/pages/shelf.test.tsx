import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountProvider } from '../lib/account'
import { resetCache } from '../lib/data'
import { money } from '../lib/format'
import type { ShelfBackend } from '../lib/shelf'
import { memoryBackend, testUser } from '../lib/shelf-memory'
import type { LatestFile } from '../lib/types'
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

    const select = await screen.findByLabelText(new RegExp(`condition of ${escapeRegExp(priced.title)}`, 'i'))
    await user.selectOptions(select, 'cib')
    await waitFor(() => expect(state.collection.get(priced.id)?.condition).toBe('cib'))
    expect(document.body.textContent).toContain(money(priced.prices.cib!.median_cents))
  })

  it('lists saved games with their price and removes one', async () => {
    if (!priced) return
    const { backend, state } = memoryBackend({ user: testUser, saved: [priced.id] })
    renderAt('/saved', <Saved />, '/saved', backend)
    const user = userEvent.setup()

    await waitFor(() => expect(document.body.textContent).toContain(priced.title))
    expect(document.body.textContent).toMatch(/1 saved/)
    await user.click(screen.getByRole('button', { name: /remove .* from saved games/i }))
    await waitFor(() => expect(document.body.textContent).toMatch(/nothing saved yet/i))
    expect(state.saved.size).toBe(0)
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

  it('the game page asks a signed-out visitor to sign in before saving', async () => {
    const { backend } = memoryBackend({ user: null })
    const { Game } = await import('./Game')
    renderAt('/g/jet-force-gemini-n64', <Game />, '/g/:id', backend)
    const save = await screen.findByRole('button', { name: /^save$/i })
    expect(save.getAttribute('aria-pressed')).toBeNull()
    expect(screen.getByRole('button', { name: /i own this/i })).toBeDefined()
  })
})

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
