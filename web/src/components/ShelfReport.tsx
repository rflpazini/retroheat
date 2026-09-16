import { useJson } from '@/lib/data'
import { heat, money, signedMoney } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { shelfByPlatform } from '@/lib/report'
import type { CollectionItem } from '@/lib/shelf'
import { PLATFORM_LABELS, PLATFORM_SHORT, type Meta } from '@/lib/types'
import { Window } from '@/components/Window'

/**
 * The shelf by platform, drawn the way About This Macintosh drew memory: one
 * bar per platform for its share of the shelf's asking value, with the
 * figures printed around it so nothing is said by the bar alone. As a
 * section it sits inside the About window under the totals; as a window it
 * stands alone.
 */
export function ShelfReport({ items, variant = 'window' }: { items: CollectionItem[]; variant?: 'window' | 'section' }) {
  const meta = useJson<Meta>('meta.json')
  const { index } = usePriceIndex()
  const rows = shelfByPlatform(items, index, meta.status === 'ready' ? meta.data.counts.per_platform : undefined)
  if (rows.length === 0) return null
  const list = (
    <ul className="space-y-3">
      {rows.map((r) => {
        const percent = Math.round(r.share * 100)
        return (
          <li key={r.platform} className="space-y-1 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{PLATFORM_LABELS[r.platform]}</p>
              <p className="tabular font-bold">{money(r.value_cents)}</p>
            </div>
            <div
              className="bevel-in h-4 border-2 border-[var(--border)] bg-[var(--card)]"
              role="img"
              aria-label={`${PLATFORM_SHORT[r.platform]}: ${percent}% of the shelf's value`}
            >
              <div className="h-full bg-[var(--primary)]" style={{ width: `${r.share * 100}%` }} />
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="eyebrow">
                {r.copies} {r.copies === 1 ? 'copy' : 'copies'} · {r.games} of {r.tracked ?? '—'} tracked
              </p>
              <p className="eyebrow">
                {percent}%
                {r.compared > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: heat(r.gain_pct) }}>{signedMoney(r.gain_cents)}</span> vs paid
                  </>
                )}
                {r.unpriced > 0 && ` · ${r.unpriced} unpriced`}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
  const caption = (
    <p className="eyebrow mt-3">
      Bars share the shelf's asking value · tracked is how many games the collector prices for the platform
    </p>
  )
  if (variant === 'section') {
    return (
      <section aria-label="Shelf by platform" className="mt-4 border-t-2 border-dotted border-[var(--input)] pt-3">
        <p className="eyebrow mb-3">By platform</p>
        {list}
        {caption}
      </section>
    )
  }
  return (
    <section aria-label="Shelf by platform">
      <Window title="Shelf by platform" order={1}>
        {list}
        {caption}
      </Window>
    </section>
  )
}
