import { StatusBar as Strip } from '@/components/retro-os/status-bar'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { formatDate, relativeDay } from '@/lib/format'
import { gamesOnDisk } from '@/lib/meta'
import { useOnline, useUpdateReady } from '@/lib/online'
import type { Meta } from '@/lib/types'

/**
 * The asking-price caveat lives on the system status strip, where it is
 * always on screen, rather than in a page footer. A shelf write that failed
 * takes the strip over until the next one succeeds: the row it came from
 * has already rolled back, so this is the only place the reason can go. The
 * strip is also where the machine says it is offline, and that a new
 * version is waiting.
 */
export function StatusBar() {
  const meta = useJson<Meta>('meta.json')
  const { error, offline } = useAccount()
  const online = useOnline()
  const applyUpdate = useUpdateReady()

  return (
    <Strip
      left={meta.status === 'ready' ? `${gamesOnDisk(meta.data)} items` : '—'}
      right={meta.status === 'ready' ? relativeDay(meta.data.generated_at) : '800×600'}
    >
      {error ? (
        <span role="alert" className="font-semibold text-[var(--destructive)]" title={error}>
          Your shelf was not saved: {error}
        </span>
      ) : applyUpdate ? (
        <span className="font-semibold">
          New version on disk ·{' '}
          <button type="button" className="underline" onClick={applyUpdate}>
            Restart
          </button>{' '}
          to run it
        </span>
      ) : !online ? (
        <span className="font-semibold">
          Offline · prices as of {meta.status === 'ready' ? formatDate(meta.data.generated_at) : 'the last visit'}
          {offline && ` · shelf as saved ${relativeDay(offline.at)}`}
        </span>
      ) : (
        <>
          Prices are the median <strong>asking price</strong> of active eBay listings, not what copies
          sold for.
          {offline && <span className="font-semibold"> Shelf as saved {relativeDay(offline.at)}, the network was away.</span>}
        </>
      )}
    </Strip>
  )
}
