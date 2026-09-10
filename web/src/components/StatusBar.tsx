import { StatusBar as Strip } from '@/components/retro-os/status-bar'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { relativeDay } from '@/lib/format'
import type { Meta } from '@/lib/types'

/**
 * The asking-price caveat lives on the system status strip, where it is
 * always on screen, rather than in a page footer. A shelf write that failed
 * takes the strip over until the next one succeeds: the row it came from
 * has already rolled back, so this is the only place the reason can go.
 */
export function StatusBar() {
  const meta = useJson<Meta>('meta.json')
  const { error } = useAccount()

  return (
    <Strip
      left={meta.status === 'ready' ? `${meta.data.counts.tracked} items` : '—'}
      right={meta.status === 'ready' ? relativeDay(meta.data.generated_at) : '800×600'}
    >
      {error ? (
        <span role="alert" className="font-semibold text-[var(--destructive)]" title={error}>
          Your shelf was not saved: {error}
        </span>
      ) : (
        <>
          Prices are the median <strong>asking price</strong> of active eBay listings, not what copies
          sold for.
        </>
      )}
    </Strip>
  )
}
