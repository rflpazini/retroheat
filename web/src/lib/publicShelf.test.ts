import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicShelf, shareLink } from './publicShelf'

const rows = [
  { game_id: 'bully-ps2', condition: 'cib', added_at: '2026-09-07T00:00:00Z', paid_cents: 1850 },
  { game_id: 'okami-ps2', condition: 'loose', added_at: '2026-09-08T00:00:00Z', paid_cents: null },
]

/** Answers like PostgREST for the two public views, for the slugs given. */
function stubREST(shelves: Record<string, typeof rows>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const headers = new Headers(init?.headers)
    if (headers.get('apikey') !== 'anon-key') return new Response('{"message":"No API key found"}', { status: 401 })
    const slug = url.searchParams.get('slug')?.replace(/^eq\./, '') ?? ''
    if (url.pathname.endsWith('/rest/v1/public_profiles')) {
      return new Response(JSON.stringify(slug in shelves ? [{ slug }] : []), { status: 200 })
    }
    if (url.pathname.endsWith('/rest/v1/shelves')) {
      return new Response(JSON.stringify(shelves[slug] ?? []), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  return calls
}

describe('fetchPublicShelf', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reads a public shelf with plain fetch and the anon key, and tells an empty shelf from a missing one', async () => {
    const calls = stubREST({ rafa: rows, empty: [] })
    const full = await fetchPublicShelf('rafa')
    expect(full).toEqual({ kind: 'shelf', slug: 'rafa', items: rows })
    expect(calls.some((c) => c.includes('/rest/v1/shelves?') && c.includes('slug=eq.rafa'))).toBe(true)

    expect(await fetchPublicShelf('empty')).toEqual({ kind: 'shelf', slug: 'empty', items: [] })
    expect(await fetchPublicShelf('nobody')).toEqual({ kind: 'missing' })
  })

  it('refuses a name that is not a shelf name before asking the database', async () => {
    const calls = stubREST({})
    expect(await fetchPublicShelf('Not A Slug!')).toEqual({ kind: 'missing' })
    expect(calls).toHaveLength(0)
  })

  it('is missing, not broken, when accounts are off', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    expect(await fetchPublicShelf('rafa')).toEqual({ kind: 'missing' })
  })

  it('reports a failing database as an error rather than an empty shelf', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }))
    await expect(fetchPublicShelf('rafa')).rejects.toThrow(/503/)
  })
})

describe('shareLink', () => {
  it('points at the public shelf under the site base, hash route and all', () => {
    expect(shareLink('rafa', 'https://rflpazini.com', '/retroheat/')).toBe('https://rflpazini.com/retroheat/#/u/rafa')
  })
})
