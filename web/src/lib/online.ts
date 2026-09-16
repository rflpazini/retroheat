import { useEffect, useState, useSyncExternalStore } from 'react'

/*
  Two things the status strip must know that no page owns: whether the
  browser has a network at all, and whether a newer build of the site is
  waiting to take over. Both arrive as browser events.
*/

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** True while the browser believes it has a network; follows the online and offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/** The name of the event the service worker registration fires when a new build is ready. */
export const UPDATE_READY = 'retroheat:update-ready'

/**
 * Null until a new version announces itself; then the function that applies
 * it (the service worker takes over and the page reloads). The announcement
 * is a window event so the code that registers the worker never has to
 * reach into React.
 */
export function useUpdateReady(): (() => void) | null {
  const [apply, setApply] = useState<(() => void) | null>(null)
  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<{ apply?: () => void }>).detail
      if (typeof detail?.apply === 'function') setApply(() => detail.apply!)
    }
    window.addEventListener(UPDATE_READY, onReady)
    return () => window.removeEventListener(UPDATE_READY, onReady)
  }, [])
  return apply
}
