import { StatusBar as Strip } from '@/components/retro-os/status-bar'
import { useJson } from '@/lib/data'
import { relativeDay } from '@/lib/format'
import type { Meta } from '@/lib/types'

/**
 * The asking-price caveat lives on the system status strip, where it is
 * always on screen, rather than in a page footer.
 */
export function StatusBar() {
  const meta = useJson<Meta>('meta.json')

  return (
    <Strip
      left={meta.status === 'ready' ? `${meta.data.counts.tracked} items` : '—'}
      right={meta.status === 'ready' ? relativeDay(meta.data.generated_at) : '800×600'}
    >
      Prices are the median <strong>asking price</strong> of active eBay listings, not what copies
      sold for.
    </Strip>
  )
}
