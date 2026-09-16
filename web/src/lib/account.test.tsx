import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AccountProvider, useAccount } from './account'
import { resetCache } from './data'
import { memoryBackend, testUser } from './shelf-memory'
import type { ShelfBackend } from './shelf'

const dataDir = path.resolve(__dirname, '../../../data')

// The shell fetches meta and boards; serve whatever the collector left on disk
// and 404 the rest. None of these tests depend on the data being present.
function serveLocalData() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) return new Response('{}', { status: 404 })
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

function renderShell(backend?: ShelfBackend) {
  const shell = (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<p>home</p>} />
        <Route path="g/:id" element={<p>game</p>} />
      </Route>
    </Routes>
  )
  return render(
    <MemoryRouter initialEntries={['/g/bully-ps2']}>
      {backend === undefined ? shell : <AccountProvider backend={() => Promise.resolve(backend)}>{shell}</AccountProvider>}
    </MemoryRouter>,
  )
}

describe('accounts', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
    sessionStorage.setItem('retroheat-booted', '1')
  })

  it('shows no account UI at all when Supabase is not configured', async () => {
    renderShell()
    await waitFor(() => expect(document.body.textContent).toMatch(/game/))
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull()
  })

  it('offers Sign in when signed out and sends a magic link', async () => {
    const { backend, state } = memoryBackend({ user: null })
    renderShell(backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /sign in/i }))
    const dialog = await screen.findByRole('dialog', { name: /sign in/i })
    expect(within(dialog).getByRole('button', { name: /continue with google/i })).toBeDefined()

    await user.type(within(dialog).getByLabelText(/e-mail address/i), 'collector@example.com')
    await user.click(within(dialog).getByRole('button', { name: /send magic link/i }))

    await waitFor(() => expect(dialog.textContent).toMatch(/check your inbox/i))
    expect(dialog.textContent).toMatch(/this device, in this browser/i)
    expect(state.sentTo).toBe('collector@example.com')
  })

  it('shows the backend error instead of a silent failure', async () => {
    const { backend } = memoryBackend({ user: null })
    renderShell(backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /sign in/i }))
    const dialog = await screen.findByRole('dialog', { name: /sign in/i })
    await user.type(within(dialog).getByLabelText(/e-mail address/i), 'nobody@example.invalid')
    await user.click(within(dialog).getByRole('button', { name: /send magic link/i }))

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/rate limit/i))
    expect(dialog.textContent).not.toMatch(/check your inbox/i)
  })

  it('returns to the page the visitor left once the provider signs them in', async () => {
    const { backend, state } = memoryBackend({ user: null })
    renderShell(backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /sign in/i }))
    const dialog = await screen.findByRole('dialog', { name: /sign in/i })
    await user.click(within(dialog).getByRole('button', { name: /continue with google/i }))
    expect(state.googleRedirect).toMatch(/^http/)
    expect(sessionStorage.getItem('retroheat-auth-return')).toBe('/g/bully-ps2')

    state.completeSignIn(testUser)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: /account menu/i })).toBeDefined()
    expect(document.body.textContent).toMatch(/game/)
    expect(sessionStorage.getItem('retroheat-auth-return')).toBeNull()
  })

  it('shows the account menu when signed in and signs out from it', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderShell(backend)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /account menu/i }))
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toMatch(/collector@example\.com/)
    await user.click(within(menu).getByRole('menuitem', { name: /sign out/i }))

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeDefined()
    expect(state.user).toBeNull()
  })
})

describe('account deletion', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
    sessionStorage.setItem('retroheat-booted', '1')
  })

  it('asks first, then removes the account and signs out', async () => {
    const { backend, state } = memoryBackend({ user: testUser, saved: ['bully-ps2'] })
    renderShell(backend)
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await user.click(await screen.findByRole('button', { name: /account menu/i }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /delete account/i }))

    expect(confirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(state.deleted).toBe(true))
    expect(state.saved.size).toBe(0)
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeDefined()
    confirm.mockRestore()
  })

  it('does nothing when the confirmation is declined', async () => {
    const { backend, state } = memoryBackend({ user: testUser })
    renderShell(backend)
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await user.click(await screen.findByRole('button', { name: /account menu/i }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /delete account/i }))

    expect(state.deleted).toBe(false)
    expect(state.user).toEqual(testUser)
    confirm.mockRestore()
  })
})

/** Reads the shelf through the same context the pages use, and pokes it. */
function ShelfProbe() {
  const a = useAccount()
  const copies = a.collection.status === 'ready' ? [...a.collection.data.values()] : []
  return (
    <div>
      <p data-testid="copies">{copies.map((c) => `${c.game_id}:${c.condition}`).join(',')}</p>
      <button type="button" onClick={() => void a.addCopy('bully-ps2', 'loose')}>
        add loose
      </button>
      <button type="button" onClick={() => void a.removeCopy(copies[0]?.id ?? '')}>
        remove first
      </button>
      <button type="button" onClick={() => void a.setOwned('bully-ps2', 'new')}>
        own sealed
      </button>
      <button type="button" onClick={() => void a.setTarget('bully-ps2', 2000)}>
        target 20
      </button>
      <button type="button" onClick={() => void a.setTarget('bully-ps2', null)}>
        clear target
      </button>
      <p data-testid="targets">
        {a.saved.status === 'ready' ? [...a.saved.data.values()].map((s) => `${s.game_id}:${s.target_cents ?? '-'}`).join(',') : ''}
      </p>
      {a.error && <p role="alert">{a.error}</p>}
    </div>
  )
}

function renderProbe(backend: ShelfBackend) {
  return render(
    <MemoryRouter initialEntries={['/collection']}>
      <AccountProvider backend={() => Promise.resolve(backend)}>
        <ShelfProbe />
      </AccountProvider>
    </MemoryRouter>,
  )
}

describe('a shelf holds several copies of one game', () => {
  const copy = (condition: 'loose' | 'cib' | 'new') => ({ game_id: 'bully-ps2', condition, added_at: '2026-09-07T00:00:00Z' })

  it('adds a second copy of a game the shelf already holds', async () => {
    const { backend, state } = memoryBackend({ user: testUser, collection: [copy('cib')] })
    renderProbe(backend)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:cib'))

    await user.click(screen.getByRole('button', { name: /add loose/i }))
    await waitFor(() => expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:cib,bully-ps2:loose'))
    expect(state.copiesOf('bully-ps2').map((c) => c.condition)).toEqual(['cib', 'loose'])
    // Every copy has a key of its own; the pair share nothing but the game.
    const ids = state.copiesOf('bully-ps2').map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('removes one copy and keeps the other', async () => {
    const { backend, state } = memoryBackend({ user: testUser, collection: [copy('cib'), copy('loose')] })
    renderProbe(backend)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:cib,bully-ps2:loose'))

    await user.click(screen.getByRole('button', { name: /remove first/i }))
    await waitFor(() => expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:loose'))
    expect(state.copiesOf('bully-ps2').map((c) => c.condition)).toEqual(['loose'])
  })

  it('refuses collection writes on a database without copy ids and says which migration', async () => {
    // A store from before migration 0004 returns rows without an id.
    const { backend, state } = memoryBackend({ user: testUser, collection: [copy('cib')], legacy: true })
    renderProbe(backend)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:cib'))

    await user.click(screen.getByRole('button', { name: /own sealed/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/0004_copies\.sql/)
    expect(state.copiesOf('bully-ps2')[0]?.condition).toBe('cib')
    expect(screen.getByTestId('copies').textContent).toBe('bully-ps2:cib')
  })
})

describe('a saved game can carry a target price', () => {
  it('records a target for a saved game and forgets it when cleared', async () => {
    const { backend, state } = memoryBackend({ user: testUser, saved: ['bully-ps2'] })
    renderProbe(backend)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByTestId('targets').textContent).toBe('bully-ps2:-'))

    await user.click(screen.getByRole('button', { name: /target 20/i }))
    await waitFor(() => expect(screen.getByTestId('targets').textContent).toBe('bully-ps2:2000'))
    expect(state.saved.get('bully-ps2')?.target_cents).toBe(2000)

    await user.click(screen.getByRole('button', { name: /clear target/i }))
    await waitFor(() => expect(screen.getByTestId('targets').textContent).toBe('bully-ps2:-'))
    expect(state.saved.get('bully-ps2')?.target_cents).toBeNull()
    expect(state.saved.has('bully-ps2')).toBe(true)
  })
})

describe('the Supabase SDK is a cost of signing in, not of reading prices', () => {
  beforeEach(() => {
    resetCache()
    serveLocalData()
    sessionStorage.setItem('retroheat-booted', '1')
  })

  it('does not load the backend for an anonymous visitor until they click Sign in', async () => {
    const { backend } = memoryBackend({ user: null })
    let loads = 0
    const loader = () => {
      loads++
      return Promise.resolve(backend)
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <AccountProvider backend={loader} eager={false}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>home</p>} />
            </Route>
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: /sign in/i })
    expect(loads).toBe(0)

    await user.click(button)
    await screen.findByRole('dialog', { name: /sign in/i })
    await waitFor(() => expect(loads).toBe(1))
  })
})
