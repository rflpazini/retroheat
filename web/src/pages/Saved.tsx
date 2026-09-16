import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { headlineFromMap, money } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { underTarget } from '@/lib/shelf'
import { CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame } from '@/lib/types'
import { OtherPrices } from '@/components/OtherPrices'
import { QuickAdd } from '@/components/QuickAdd'
import { ShelfGate, ShelfRowControls, shelfButton } from '@/components/ShelfControls'
import { Message } from '@/components/States'
import { TargetField } from '@/components/TargetField'
import { TrendPill } from '@/components/TrendPill'
import { Window } from '@/components/Window'

export function Saved() {
  return (
    <ShelfGate what="saved games">
      <SavedList />
    </ShelfGate>
  )
}

function SavedList() {
  const account = useAccount()
  const catalog = useJson<CatalogFile>('catalog.json')
  const { index, loading } = usePriceIndex()

  if (account.saved.status === 'loading' || loading || catalog.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (account.saved.status === 'error') {
    return <Message title="Could not load your saved games" detail={account.saved.error} />
  }

  const byId = new Map<string, CatalogGame>(catalog.status === 'ready' ? catalog.data.games.map((g) => [g.id, g]) : [])
  const rows = [...account.saved.data.values()].sort((a, b) =>
    (byId.get(a.game_id)?.title ?? a.game_id).localeCompare(byId.get(b.game_id)?.title ?? b.game_id),
  )
  // The target is the alert: a saved game asking no more than its owner would pay says so on its row.
  const targets = account.targetSupported
  const hits = new Set(underTarget(rows, index).map((h) => h.game_id))

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <QuickAdd mode="save" />
        <Message
          title="Nothing saved yet"
          detail="Search above, or open any game and press Save to keep it here with today's price beside it."
          action={
            <Link to="/" className={shelfButton}>
              Browse the boards
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <QuickAdd mode="save" />
      <Window title="Saved games" bodyClassName="p-0" stripe order={1}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] p-3">
          <p className="eyebrow">
            {rows.length} saved{targets && ` · ${hits.size} under target`} · asking prices, not appraisals
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className={`w-full border-collapse ${targets ? 'min-w-[44rem]' : 'min-w-[36rem]'}`}>
            <thead>
              <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
                <th scope="col" className="p-2 text-left">
                  <span className="eyebrow">Game</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Price</span>
                </th>
                {targets && (
                  <th scope="col" className="p-2 text-right">
                    <span className="eyebrow">Target</span>
                  </th>
                )}
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">7 days</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Shelf</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const id = s.game_id
                const game = byId.get(id)
                const title = game?.title ?? id
                const entry = index.get(id)
                const headline = headlineFromMap(entry?.prices)
                const under = hits.has(id)
                return (
                  <tr key={id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                    <td className="p-2">
                      <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                        {title}
                      </Link>
                      <p className="eyebrow mt-0.5">
                        {game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'}
                        {entry?.stale && ' · stale'}
                      </p>
                    </td>
                    <td className="p-2 text-right">
                      {headline ? (
                        <div className="flex flex-col items-end">
                          <span className="tabular text-xs font-bold">{money(headline.cents)}</span>
                          <span className="eyebrow">{CONDITION_LABELS[headline.condition]}</span>
                          {entry && <OtherPrices prices={entry.prices} headline={headline.condition} />}
                          {under && (
                            <span className="eyebrow mt-0.5 border border-[var(--border)] bg-[var(--accent)] px-1 text-[var(--accent-foreground)]">
                              Under target
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    {targets && (
                      <td className="p-2 text-right">
                        <TargetField gameId={id} title={title} value={s.target_cents ?? null} />
                      </td>
                    )}
                    <td className="p-2 text-right">
                      <TrendPill value={entry?.pct_7d ?? null} showIcon={false} />
                    </td>
                    <td className="p-2 text-right">
                      <ShelfRowControls gameId={id} title={title} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {targets && (
          <p className="border-t border-[var(--input)] p-3 text-[0.65rem] text-[var(--muted-foreground)]">
            A target is the most you would pay. A row says “Under target” when today's headline asking price is at or
            under it; nothing is sent, the list is the alert.
          </p>
        )}
      </Window>
    </div>
  )
}
