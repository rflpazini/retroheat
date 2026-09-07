import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { headlinePrice, money, priceMap } from '@/lib/format'
import { useLatestIndex } from '@/lib/latest'
import { CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame } from '@/lib/types'
import { OtherPrices } from '@/components/OtherPrices'
import { ConditionSelect, ShelfGate, shelfButton } from '@/components/ShelfControls'
import { Message } from '@/components/States'
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
  const { index, loading } = useLatestIndex(true)

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
  const ids = [...account.saved.data].sort((a, b) =>
    (byId.get(a)?.title ?? a).localeCompare(byId.get(b)?.title ?? b),
  )

  if (ids.length === 0) {
    return (
      <Message
        title="Nothing saved yet"
        detail="Open any game and press Save to keep it here, with today's price beside it."
        action={
          <Link to="/" className={shelfButton}>
            Browse the boards
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <Window title="Saved games" bodyClassName="p-0" stripe order={0}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] p-3">
          <p className="eyebrow">{ids.length} saved · asking prices, not appraisals</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead>
              <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
                <th scope="col" className="p-2 text-left">
                  <span className="eyebrow">Game</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Price</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">7 days</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Shelf</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => {
                const game = byId.get(id)
                const latest = index.get(id)
                const headline = latest ? headlinePrice(latest.prices) : null
                const owned = account.owned(id)
                return (
                  <tr key={id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                    <td className="p-2">
                      <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                        {game?.title ?? latest?.title ?? id}
                      </Link>
                      <p className="eyebrow mt-0.5">
                        {game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'}
                        {latest?.stale && ' · stale'}
                      </p>
                    </td>
                    <td className="p-2 text-right">
                      {headline ? (
                        <div className="flex flex-col items-end">
                          <span className="tabular text-xs font-bold">{money(headline.cents)}</span>
                          <span className="eyebrow">{CONDITION_LABELS[headline.condition]}</span>
                          {latest && <OtherPrices prices={priceMap(latest.prices)} headline={headline.condition} />}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <TrendPill value={latest?.pct_7d ?? null} showIcon={false} />
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <ConditionSelect
                          value={owned?.condition ?? ''}
                          label={`Own ${game?.title ?? id} as`}
                          placeholder="Own it as…"
                          onChange={(c) => void account.setOwned(id, c)}
                        />
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => void account.toggleSaved(id)}
                          aria-label={`Remove ${game?.title ?? id} from saved games`}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Window>
      {account.error && (
        <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
          {account.error}
        </p>
      )}
    </div>
  )
}
