import { describe, expect, it, vi } from 'vitest'
import { importFresh, isStaleChunkError, reloadForNewVersion, type ReloadDeps } from './lazy'

function deps(last?: number): ReloadDeps & { reload: ReturnType<typeof vi.fn>; store: Map<string, string> } {
  const store = new Map<string, string>()
  if (last !== undefined) store.set('retroheat-reloaded-at', String(last))
  return {
    reload: vi.fn(),
    store,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => 1_000_000,
  }
}

const gone = new TypeError('Failed to fetch dynamically imported module: https://x/assets/Saved-D6ELg5ms.js')

describe('recovering from a chunk that a deploy replaced', () => {
  it('recognises the browsers\' wording for a missing module', () => {
    expect(isStaleChunkError(gone)).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/Game-abc.css'))).toBe(true)
    expect(isStaleChunkError(new Error('boards are empty'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })

  it('reloads once and remembers when', () => {
    const d = deps()
    expect(reloadForNewVersion(d)).toBe(true)
    expect(d.reload).toHaveBeenCalledTimes(1)
    expect(d.store.get('retroheat-reloaded-at')).toBe('1000000')
  })

  it('refuses a second reload within a minute, so a broken deploy cannot loop the page', () => {
    const d = deps(1_000_000 - 30_000)
    expect(reloadForNewVersion(d)).toBe(false)
    expect(d.reload).not.toHaveBeenCalled()
  })

  it('reloads again once the minute has passed', () => {
    const d = deps(1_000_000 - 61_000)
    expect(reloadForNewVersion(d)).toBe(true)
  })

  it('importFresh passes a good import straight through', async () => {
    const d = deps()
    expect(await importFresh(() => Promise.resolve({ ok: 1 }), d)).toEqual({ ok: 1 })
    expect(d.reload).not.toHaveBeenCalled()
  })

  it('importFresh reloads on a stale chunk and keeps the promise pending', async () => {
    const d = deps()
    const pending = importFresh(() => Promise.reject(gone), d)
    const settled = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(settled).toBe('pending')
    expect(d.reload).toHaveBeenCalledTimes(1)
  })

  it('importFresh throws when it already reloaded, and for any other error', async () => {
    const recent = deps(1_000_000 - 5_000)
    await expect(importFresh(() => Promise.reject(gone), recent)).rejects.toBe(gone)
    expect(recent.reload).not.toHaveBeenCalled()

    const d = deps()
    const other = new Error('render exploded')
    await expect(importFresh(() => Promise.reject(other), d)).rejects.toBe(other)
    expect(d.reload).not.toHaveBeenCalled()
  })
})
