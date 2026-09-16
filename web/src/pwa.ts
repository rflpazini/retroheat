import { registerSW } from 'virtual:pwa-register'
import { dataURL } from '@/lib/data'
import { UPDATE_READY } from '@/lib/online'

/*
  The site as a pocket price guide. The service worker keeps the shell and
  every data file the browser has seen, so a board opened at a flea market
  still opens with no signal, with the prices of the last visit. A new deploy
  is announced on the status strip rather than applied under the visitor's
  feet; Restart there hands over and reloads. Imported only from main.tsx, so
  tests never meet the virtual module.
*/

// What a search and a shelf need, fetched once when the browser is idle so
// they sit in the cache before the signal goes: the boot set plus the light
// catalog and the price index, about 370 KB gzipped.
const WARM = ['meta.json', 'trending/all.json', 'catalog.json', 'prices.json']

function warm() {
  const run = () => {
    for (const rel of WARM) void fetch(dataURL(rel)).catch(() => {})
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (idle) idle(run)
  else setTimeout(run, 3000)
}

export function startOffline() {
  if (!('serviceWorker' in navigator)) return
  const update = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(UPDATE_READY, { detail: { apply: () => void update(true) } }))
    },
    onRegisteredSW() {
      warm()
    },
  })
}
