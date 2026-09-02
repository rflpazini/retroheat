import { useJson } from '@/lib/data'
import { relativeDay } from '@/lib/format'
import type { Meta } from '@/lib/types'

/**
 * The system status strip. An operating system reports its state on a thin bar,
 * not in a page footer, so the asking-price caveat lives here where it is
 * always on screen.
 */
export function StatusBar() {
  const meta = useJson<Meta>('meta.json')

  return (
    <div
      className="sticky bottom-0 z-40 flex items-center justify-between gap-3 border-t-2 border-[var(--border)] px-2 py-1"
      style={{ background: 'var(--menubar)' }}
    >
      <span className="bevel-in hidden shrink-0 border border-[var(--border)] px-2 py-0.5 sm:block">
        <span className="eyebrow">
          {meta.status === 'ready' ? `${meta.data.counts.tracked} items` : '—'}
        </span>
      </span>

      <p className="min-w-0 flex-1 truncate text-[0.7rem]">
        Prices are the median <strong>asking price</strong> of active eBay listings, not what
        copies sold for.
      </p>

      <span className="bevel-in shrink-0 border border-[var(--border)] px-2 py-0.5">
        <span className="eyebrow">
          {meta.status === 'ready' ? relativeDay(meta.data.generated_at) : '800×600'}
        </span>
      </span>
    </div>
  )
}
