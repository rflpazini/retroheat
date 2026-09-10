import { useEffect, useState } from 'react'

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T }

const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

export function dataURL(rel: string): string {
  return `${import.meta.env.BASE_URL}data/${rel}`
}

async function load<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as T
}

/**
 * useJson fetches a static data file once per session. The site is served
 * alongside its own JSON, so a Map cache is all the state management this
 * needs.
 */
export function useJson<T>(rel: string | null): Loadable<T> {
  const url = rel === null ? null : dataURL(rel)

  function initial(): Loadable<T> {
    return url && cache.has(url)
      ? { status: 'ready', data: cache.get(url) as T }
      : { status: 'loading' }
  }

  const [state, setState] = useState<Loadable<T>>(initial)

  // Reset during render when the URL changes. Waiting for the effect would
  // paint one frame of the previous file's data under the new heading — swap
  // between two already-cached platform boards and you would see the old rows
  // beneath the new title.
  const [renderedURL, setRenderedURL] = useState(url)
  if (url !== renderedURL) {
    setRenderedURL(url)
    setState(initial())
  }

  useEffect(() => {
    if (!url) return
    if (cache.has(url)) {
      setState({ status: 'ready', data: cache.get(url) as T })
      return
    }

    let active = true
    setState({ status: 'loading' })
    loadCached<T>(url).then(
      (data) => {
        if (active) setState({ status: 'ready', data })
      },
      (err: unknown) => {
        if (active) setState({ status: 'error', error: messageOf(err) })
      },
    )

    return () => {
      active = false
    }
  }, [url])

  return state
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'failed')

/** One fetch per file, shared: the cache answers repeats and the in-flight map joins concurrent asks. */
function loadCached<T>(url: string): Promise<T> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) as T)
  let promise = inflight.get(url) as Promise<T> | undefined
  if (!promise) {
    promise = load<T>(url).then(
      (data) => {
        cache.set(url, data)
        inflight.delete(url)
        return data
      },
      (err: unknown) => {
        inflight.delete(url)
        throw err
      },
    )
    inflight.set(url, promise)
  }
  return promise
}

/**
 * useJsonMany fetches a set of files at once, through the same cache, and
 * resolves when every request has settled. A file that fails to load is left
 * out of the map rather than failing the set: a shelf's timeline should not
 * vanish because one game is no longer tracked. When every file fails, that
 * is an error, not an empty result, and the caller can say so.
 */
export function useJsonMany<T>(rels: string[]): Loadable<Map<string, T>> {
  // The list is compared by content, so a caller may build it inline.
  const key = rels.join('\n')
  const [state, setState] = useState<Loadable<Map<string, T>>>(() =>
    key ? { status: 'loading' } : { status: 'ready', data: new Map() },
  )

  useEffect(() => {
    const list = key ? key.split('\n') : []
    if (list.length === 0) {
      setState({ status: 'ready', data: new Map() })
      return
    }
    let active = true
    setState({ status: 'loading' })
    void Promise.allSettled(list.map((rel) => loadCached<T>(dataURL(rel)))).then((results) => {
      if (!active) return
      const data = new Map<string, T>()
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') data.set(list[i], r.value)
      })
      if (data.size === 0) {
        const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        setState({ status: 'error', error: `none of ${list.length} files could be loaded (${messageOf(first?.reason)})` })
        return
      }
      setState({ status: 'ready', data })
    })
    return () => {
      active = false
    }
  }, [key])

  return state
}

export function resetCache() {
  cache.clear()
  inflight.clear()
}
