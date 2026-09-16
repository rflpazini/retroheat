import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { formatDate, heat, moneyExact, pct, signedMoney } from '@/lib/format'
import type { SoldSummary } from '@/lib/shelf'
import { PLATFORM_SHORT, CONDITION_LABELS, type CatalogGame } from '@/lib/types'
import { shelfButton } from '@/components/ShelfControls'
import { TrendPill } from '@/components/TrendPill'

/**
 * The copies that left the shelf, with what they made, as the last section
 * of the collection window: a sunken strip names it and totals it, then the
 * sales, newest first. The gain here is realized, money that changed hands,
 * which is why it sits apart from the shelf value's paper gain.
 */
export function SoldWindow({ summary, byId }: { summary: SoldSummary; byId: Map<string, CatalogGame> }) {
  const account = useAccount()
  if (summary.lines.length === 0) return null
  const nameOf = (id: string) => byId.get(id)?.title ?? id
  return (
    <section aria-label="Sold" className="border-t-2 border-[var(--border)]">
      <div className="bevel-in flex flex-wrap items-end gap-x-8 gap-y-3 border-b-2 border-[var(--border)] px-3 py-2">
        <p className="pixel self-center text-[0.6rem]">Sold</p>
        {summary.compared > 0 ? (
          <>
            <div>
              <p className="eyebrow">Paid</p>
              <p className="tabular text-sm font-bold">{moneyExact(summary.paid_cents)}</p>
            </div>
            <div>
              <p className="eyebrow">Sold for</p>
              <p className="tabular text-sm font-bold">{moneyExact(summary.sold_cents)}</p>
            </div>
            <div>
              <p className="eyebrow">Realized gain</p>
              <p className="flex items-center gap-2">
                <span className="tabular text-sm font-bold" style={{ color: heat(summary.gain_pct) }}>
                  {signedMoney(summary.gain_cents)}
                </span>
                {summary.gain_pct !== null && <TrendPill value={summary.gain_pct} showIcon={false} />}
              </p>
            </div>
            <p className="eyebrow self-center">
              {summary.compared} of {summary.lines.length} compared
            </p>
          </>
        ) : (
          <p className="eyebrow self-center">
            {summary.lines.length} sold · type what a copy cost and sold for to read the gain
          </p>
        )}
      </div>
      <table className="w-full min-w-[40rem] border-collapse">
        <thead>
          <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
            <th scope="col" className="p-2 text-left">
              <span className="eyebrow">Game</span>
            </th>
            <th scope="col" className="p-2 text-right">
              <span className="eyebrow">Paid</span>
            </th>
            <th scope="col" className="p-2 text-right">
              <span className="eyebrow">Sold for</span>
            </th>
            <th scope="col" className="p-2 text-right">
              <span className="eyebrow">Gain</span>
            </th>
            <th scope="col" className="p-2 text-right">
              <span className="eyebrow">Sold on</span>
            </th>
            <th scope="col" className="p-2 text-right">
              <span className="eyebrow">Shelf</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.lines.map((l) => {
            const id = l.item.game_id
            const game = byId.get(id)
            return (
              <tr key={l.item.id ?? id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                <td className="p-2">
                  <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                    {nameOf(id)}
                  </Link>
                  <p className="eyebrow mt-0.5">
                    {game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'} · {CONDITION_LABELS[l.item.condition]}
                  </p>
                </td>
                <td className="tabular p-2 text-right text-xs">{l.paid_cents === null ? '—' : moneyExact(l.paid_cents)}</td>
                <td className="tabular p-2 text-right text-xs font-bold">{l.sold_cents === null ? '—' : moneyExact(l.sold_cents)}</td>
                <td className="p-2 text-right">
                  {l.gain_cents === null ? (
                    <span className="text-xs text-[var(--muted-foreground)]">—</span>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="tabular text-xs font-bold" style={{ color: heat(l.gain_pct) }}>
                        {signedMoney(l.gain_cents)}
                      </span>
                      {l.gain_pct !== null && <span className="eyebrow">{pct(l.gain_pct)} vs paid</span>}
                    </div>
                  )}
                </td>
                <td className="tabular p-2 text-right text-xs">{l.item.sold_on ? formatDate(l.item.sold_on) : '—'}</td>
                <td className="p-2 text-right">
                  {l.item.id && (
                    <button
                      type="button"
                      className={shelfButton}
                      aria-label={`Info on ${nameOf(id)}`}
                      onClick={() => account.openInfo(l.item.id!)}
                    >
                      Info…
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
