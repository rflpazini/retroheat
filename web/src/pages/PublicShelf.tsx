import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { messageOf } from '@/lib/account'
import { useJson, type Loadable } from '@/lib/data'
import { conditionColor, heat, money, moneyExact, signedMoney } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { fetchPublicShelf, type PublicShelfResult } from '@/lib/publicShelf'
import { shelfValue, type CollectionItem } from '@/lib/shelf'
import { CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame } from '@/lib/types'
import { Message } from '@/components/States'
import { TrendPill } from '@/components/TrendPill'
import { Window } from '@/components/Window'

/**
 * Someone else's shelf, opened from a link: read-only, priced at today's
 * asking medians like the owner's own page, with paid prices only when the
 * owner chose to share them. No controls, no account needed.
 */
export function PublicShelf() {
  const { slug = '' } = useParams()
  const [result, setResult] = useState<Loadable<PublicShelfResult>>({ status: 'loading' })
  const catalog = useJson<CatalogFile>('catalog.json')
  const { index, loading } = usePriceIndex()

  useEffect(() => {
    let cancelled = false
    setResult({ status: 'loading' })
    fetchPublicShelf(slug)
      .then((r) => !cancelled && setResult({ status: 'ready', data: r }))
      .catch((e: unknown) => !cancelled && setResult({ status: 'error', error: messageOf(e) }))
    return () => {
      cancelled = true
    }
  }, [slug])

  if (result.status === 'loading' || loading || catalog.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (result.status === 'error') return <Message title="Could not read this shelf" detail={result.error} />
  if (result.data.kind === 'missing') {
    return (
      <Message
        title="No such shelf"
        detail="Nobody shares a shelf by that name, or its owner made it private. Shelves are private unless their owner turns sharing on."
      />
    )
  }

  const byId = new Map<string, CatalogGame>(catalog.status === 'ready' ? catalog.data.games.map((g) => [g.id, g]) : [])
  const items: CollectionItem[] = result.data.items.map((it, i) => ({
    id: `${slug}-${i}`,
    game_id: it.game_id,
    condition: it.condition,
    added_at: it.added_at,
    paid_cents: it.paid_cents,
  }))
  const value = shelfValue(items, index)
  const showPaid = items.some((i) => i.paid_cents != null)
  const nameOf = (id: string) => byId.get(id)?.title ?? id

  return (
    <div className="space-y-4">
      <Window title={`${slug}'s shelf`} stripe order={0}>
        <p className="eyebrow">Shelf value</p>
        <p className="tabular text-3xl font-bold">{money(value.total_cents)}</p>
        <p className="eyebrow mt-2">
          {items.length} {items.length === 1 ? 'copy' : 'copies'} · {value.priced} priced · shared from RetroHeat · asking
          prices, not appraisals
        </p>
        {showPaid && value.compared > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 border-t-2 border-dotted border-[var(--input)] pt-3">
            <div>
              <p className="eyebrow">Paid</p>
              <p className="tabular text-lg font-bold">{moneyExact(value.paid_cents)}</p>
            </div>
            <div>
              <p className="eyebrow">Asking today</p>
              <p className="tabular text-lg font-bold">{moneyExact(value.today_cents)}</p>
            </div>
            <div>
              <p className="eyebrow">Gain</p>
              <p className="flex items-center gap-2">
                <span className="tabular text-lg font-bold" style={{ color: heat(value.gain_pct) }}>
                  {signedMoney(value.gain_cents)}
                </span>
                {value.gain_pct !== null && <TrendPill value={value.gain_pct} showIcon={false} />}
              </p>
            </div>
          </div>
        )}
      </Window>

      {items.length === 0 ? (
        <Message title="An empty shelf" detail="Nothing on it yet." />
      ) : (
        <Window title="Shelf" bodyClassName="p-0" order={1}>
          <div className="overflow-x-auto">
            <table className={`w-full border-collapse ${showPaid ? 'min-w-[40rem]' : 'min-w-[32rem]'}`}>
              <thead>
                <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
                  <th scope="col" className="p-2 text-left">
                    <span className="eyebrow">Game</span>
                  </th>
                  <th scope="col" className="p-2 text-left">
                    <span className="eyebrow">Condition</span>
                  </th>
                  {showPaid && (
                    <th scope="col" className="p-2 text-right">
                      <span className="eyebrow">Paid</span>
                    </th>
                  )}
                  <th scope="col" className="p-2 text-right">
                    <span className="eyebrow">Asking today</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {value.lines.map((l) => {
                  const id = l.item.game_id
                  const game = byId.get(id)
                  return (
                    <tr key={l.item.id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                      <td className="p-2">
                        <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                          {nameOf(id)}
                        </Link>
                        <p className="eyebrow mt-0.5">{game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'}</p>
                      </td>
                      <td className="p-2">
                        <span className="flex items-center gap-1.5">
                          <span className="h-1 w-4" style={{ background: conditionColor(l.item.condition) }} aria-hidden />
                          <span className="eyebrow">{CONDITION_LABELS[l.item.condition]}</span>
                        </span>
                      </td>
                      {showPaid && (
                        <td className="tabular p-2 text-right text-xs">{l.paid_cents === null ? '—' : moneyExact(l.paid_cents)}</td>
                      )}
                      <td className="tabular p-2 text-right text-xs font-bold">{money(l.price_cents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Window>
      )}
    </div>
  )
}
