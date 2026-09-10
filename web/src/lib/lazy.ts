/*
  Every deploy renames the hashed chunks and GitHub Pages keeps no old ones.
  A tab opened before a deploy still holds the old index, so the first lazy
  route it visits afterwards fetches a file that is gone. The cure is a
  reload, once: the fresh index names the fresh chunks. A second failure in
  quick succession means something else is wrong, and the route's error
  window should say so instead of the page reloading forever.
*/
const KEY = 'retroheat-reloaded-at'
const WINDOW_MS = 60_000

export interface ReloadDeps {
  reload: () => void
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  now: () => number
}

function browserDeps(): ReloadDeps {
  let storage: ReloadDeps['storage'] = null
  try {
    storage = window.sessionStorage
  } catch {
    storage = null
  }
  return { reload: () => window.location.reload(), storage, now: Date.now }
}

/** True when a dynamic import failed because the file behind it is gone or unreachable. */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    message,
  )
}

/**
 * Reloads the page to pick up a new version, unless it already did so within
 * the last minute. Returns whether a reload was started.
 */
export function reloadForNewVersion(deps: ReloadDeps = browserDeps()): boolean {
  let last = 0
  try {
    last = Number(deps.storage?.getItem(KEY) ?? 0)
  } catch {
    last = 0
  }
  const now = deps.now()
  if (now - last < WINDOW_MS) return false
  try {
    deps.storage?.setItem(KEY, String(now))
  } catch {
    // Without storage the guard is lost, but a reload is still the right move once.
  }
  deps.reload()
  return true
}

/**
 * Runs a dynamic import. A stale-chunk failure reloads the page once and
 * leaves the promise pending, since the page is about to go away; any other
 * failure, or a repeat, is thrown for the route's error window.
 */
export async function importFresh<T>(load: () => Promise<T>, deps?: ReloadDeps): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (isStaleChunkError(error) && reloadForNewVersion(deps)) {
      return new Promise<T>(() => {})
    }
    throw error
  }
}
