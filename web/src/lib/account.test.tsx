import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AccountProvider } from './account'
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
