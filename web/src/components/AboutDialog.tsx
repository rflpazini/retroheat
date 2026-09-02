import { useEffect, useRef } from 'react'
import { useJson } from '@/lib/data'
import { formatDate } from '@/lib/format'
import type { Meta } from '@/lib/types'

/**
 * "About This RetroHeat", modelled on About This Macintosh: identity lines,
 * then a table of what the machine is holding. It is also where the caveat
 * about asking prices is stated in full.
 *
 * Deliberately not built on a dialog primitive. Opening one from a menu means
 * the menu's own focus restore and the dialog's focus trap fight each other,
 * and this window needs nothing the primitive provides beyond Escape, a focus
 * trap of its own and a backdrop.
 */
export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const meta = useJson<Meta>('meta.json')
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return

    restoreRef.current = document.activeElement
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus()
    }
  }, [open, onOpenChange])

  if (!open) return null

  const counts = meta.status === 'ready' ? meta.data.counts : null
  const rows: [string, string][] = [
    ['Games tracked', counts ? String(counts.tracked) : '—'],
    ['Priced this run', counts ? String(counts.ok) : '—'],
    ['Stale', counts ? String(counts.stale) : '—'],
    ['Failed', counts ? String(counts.failed) : '—'],
    ['Data source', meta.status === 'ready' ? meta.data.source : '—'],
    ['Price kind', meta.status === 'ready' ? meta.data.price_kind : '—'],
    ['API calls used', meta.status === 'ready' ? String(meta.data.api_calls_used) : '—'],
    ['Last run', meta.status === 'ready' ? formatDate(meta.data.generated_at) : '—'],
  ]

  const used = counts ? counts.ok : 0
  const total = counts ? Math.max(counts.tracked, 1) : 1

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-24">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="window animate-window relative w-full max-w-lg"
      >
        <div className="window-title flex items-center gap-2 px-2 py-1">
          <button
            ref={closeRef}
            onClick={() => onOpenChange(false)}
            className="title-box press shrink-0"
            aria-label="Close About window"
          />
          <span className="flex min-w-0 flex-1 justify-center">
            <span id="about-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
              About This RetroHeat
            </span>
          </span>
          <span className="title-box shrink-0" aria-hidden />
        </div>
        <div className="stripe" aria-hidden />

        <div className="p-5">
          <div className="mb-4 flex items-start gap-4">
            <div className="bevel flex size-14 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)]">
              <span className="pixel text-[0.6rem]">RH</span>
            </div>
            <div>
              <p className="pixel text-[0.7rem]">RetroHeat</p>
              <p className="mt-1 text-[0.7rem]">Retro game price momentum</p>
              <p className="text-[0.7rem] opacity-70">Open source · MIT</p>
            </div>
          </div>

          <div className="bevel-in mb-4 border-2 border-[var(--border)] p-3">
            <p className="mb-2 text-[0.7rem]">
              <strong>Prices are asking prices.</strong> They are the median of active eBay
              listings, not what copies actually sold for. eBay retired public access to
              sold-listing data, so no free source of true sale prices exists. The direction a
              price moves is meaningful; the number itself is not an appraisal.
            </p>
            <div className="flex items-center gap-2">
              <span className="eyebrow shrink-0">Catalog priced</span>
              <span className="bevel-in h-3 flex-1 border border-[var(--border)] bg-[var(--muted)]">
                <span
                  className="block h-full"
                  style={{ width: `${(used / total) * 100}%`, background: 'var(--stripe-1)' }}
                />
              </span>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-3 border-b border-dotted border-[var(--input)] py-0.5 text-[0.7rem]"
              >
                <dt className="opacity-70">{label}</dt>
                <dd className="tabular font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
