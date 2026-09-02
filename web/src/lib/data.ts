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
    let promise = inflight.get(url)
    if (!promise) {
      promise = load<T>(url)
      inflight.set(url, promise)
    }

    setState({ status: 'loading' })
    promise
      .then((data) => {
        cache.set(url, data)
        inflight.delete(url)
        if (active) setState({ status: 'ready', data: data as T })
      })
      .catch((err: unknown) => {
        inflight.delete(url)
        if (active) setState({ status: 'error', error: err instanceof Error ? err.message : 'failed' })
      })

    return () => {
      active = false
    }
  }, [url])

  return state
}

export function resetCache() {
  cache.clear()
  inflight.clear()
}
