import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { conditionColor, money } from '@/lib/format'
import { useLatestIndex } from '@/lib/latest'
import { shelfValue, type ShelfLine } from '@/lib/shelf'
import { CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame } from '@/lib/types'
import { ConditionSelect, ShelfGate, shelfButton } from '@/components/ShelfControls'
import { Message } from '@/components/States'
import { TrendPill } from '@/components/TrendPill'
import { Window } from '@/components/Window'

export function Collection() {
  return (
    <ShelfGate what="collection">
      <Shelf />
    </ShelfGate>
  )
}

function Shelf() {
  const account = useAccount()
  const catalog = useJson<CatalogFile>('catalog.json')
  const { index, loading } = useLatestIndex(true)

  if (account.collection.status === 'loading' || loading || catalog.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (account.collection.status === 'error') {
    return <Message title="Could not load your collection" detail={account.collection.error} />
  }

  const items = [...account.collection.data.values()]
  if (items.length === 0) {
    return (
      <Message
        title="Nothing on the shelf yet"
        detail="Open a game and mark it as owned, with the condition of your copy. The shelf value adds up what those copies are asking today."
        action={
          <Link to="/" className={shelfButton}>
            Browse the boards
          </Link>
        }
      />
    )
  }

  const byId = new Map<string, CatalogGame>(catalog.status === 'ready' ? catalog.data.games.map((g) => [g.id, g]) : [])
  const value = shelfValue(items, index)
  const nameOf = (l: ShelfLine) => l.latest?.title ?? byId.get(l.item.game_id)?.title ?? l.item.game_id

  return (
    <div className="space-y-4">
      <Window title="My collection — shelf value" stripe order={0}>
        <p className="eyebrow">Shelf value</p>
        <p className="tabular text-3xl font-bold">{money(value.total_cents)}</p>
        <p className="eyebrow mt-2">
          {items.length} {items.length === 1 ? 'game' : 'games'} · {value.priced} priced · {value.unpriced} unpriced at
          their condition · asking prices, not appraisals
        </p>
      </Window>

      {value.movers.length > 0 && (
        <Window title="What moved this week" order={1}>
          <ul className="divide-y divide-dotted divide-[var(--input)]">
            {value.movers.map((l) => (
              <li key={l.item.game_id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <Link to={`/g/${l.item.game_id}`} className="font-semibold hover:text-[var(--primary)]">
                  {nameOf(l)}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="tabular">{money(l.price_cents)}</span>
                  <TrendPill value={l.latest?.pct_7d ?? null} showIcon={false} />
                </span>
              </li>
            ))}
          </ul>
          <p className="eyebrow mt-3">7 day move of each game's headline price</p>
        </Window>
      )}

      <Window title="Shelf" bodyClassName="p-0" order={2}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead>
              <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
                <th scope="col" className="p-2 text-left">
                  <span className="eyebrow">Game</span>
                </th>
                <th scope="col" className="p-2 text-left">
                  <span className="eyebrow">Condition</span>
                </th>
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Today</span>
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
              {value.lines.map((l) => {
                const id = l.item.game_id
                const game = byId.get(id)
                return (
                  <tr key={id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                    <td className="p-2">
                      <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                        {nameOf(l)}
                      </Link>
                      <p className="eyebrow mt-0.5">
                        {game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'}
                        {l.latest?.stale && ' · stale'}
                      </p>
                    </td>
                    <td className="p-2">
                      <span className="flex items-center gap-1.5">
                        <span className="h-1 w-4" style={{ background: conditionColor(l.item.condition) }} aria-hidden />
                        <span className="eyebrow">{CONDITION_LABELS[l.item.condition]}</span>
                      </span>
                    </td>
                    <td className="tabular p-2 text-right text-xs font-bold">{money(l.price_cents)}</td>
                    <td className="p-2 text-right">
                      <TrendPill value={l.latest?.pct_7d ?? null} showIcon={false} />
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <ConditionSelect
                          value={l.item.condition}
                          label={`Condition of ${nameOf(l)}`}
                          onChange={(c) => void account.setOwned(id, c)}
                        />
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => void account.setOwned(id, null)}
                          aria-label={`Remove ${nameOf(l)} from my collection`}
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

      <p className="text-[0.7rem] text-[var(--card-foreground)]">
        <span className="window inline-block px-2 py-1">
          A dash means no listing in that condition cleared the four-listing minimum today.
        </span>
      </p>
      {account.error && (
        <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
          {account.error}
        </p>
      )}
    </div>
  )
}
