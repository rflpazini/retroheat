import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { conditionColor, heat, money, moneyExact, pct, signedMoney } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { onShelf, shelfValue, soldSummary, type CollectionItem, type ShelfLine, type ShelfValue } from '@/lib/shelf'
import { CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PaidField } from '@/components/PaidField'
import { QuickAdd } from '@/components/QuickAdd'
import { ShelfReport } from '@/components/ShelfReport'
import { ShelfTimeline } from '@/components/ShelfTimeline'
import { ShelfGate, ShelfRowControls, shelfButton } from '@/components/ShelfControls'
import { SoldWindow } from '@/components/SoldWindow'
import { Message } from '@/components/States'
import { TrendPill } from '@/components/TrendPill'
import { Window, WindowPane } from '@/components/Window'

export function Collection() {
  return (
    <ShelfGate what="collection">
      <Shelf />
    </ShelfGate>
  )
}

/*
  The collection is one Finder window: the add field and the total on its
  header strip, the copies in a pane that scrolls on its own, the sales as
  the pane's last section. On a wide desktop a second column stands beside
  it, the way a Get Info panel sat beside a Finder window: About this shelf
  (what it adds up to, read against what it cost, split by platform), the
  line over time and the week's movers, scrolling on its own so the table
  keeps the height. Below that width the windows flow, as every page does.
*/
const wide = {
  layout: 'min-[80rem]:grid min-[80rem]:grid-cols-[minmax(0,1fr)_18rem] min-[80rem]:grid-rows-[minmax(0,1fr)]',
  // Only inside the grid may the column shrink to the row; in a flowing
  // page it keeps its content height, or the window collapses to its title.
  main: 'min-[80rem]:min-h-0 min-[80rem]:col-start-1 min-[80rem]:row-start-1',
  side: 'min-[80rem]:col-start-2 min-[80rem]:row-start-1 min-[80rem]:min-h-0 min-[80rem]:pane min-[80rem]:-m-1 min-[80rem]:p-1',
}

/* The heads stay put while the rows scroll under them; the rule under them travels with the cells. */
const headCell = 'sticky top-0 z-10 bg-[var(--muted)] p-2 shadow-[0_2px_0_0_var(--border)]'

function Shelf() {
  const account = useAccount()
  const catalog = useJson<CatalogFile>('catalog.json')
  const { index, loading } = usePriceIndex()

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
  const byId = new Map<string, CatalogGame>(catalog.status === 'ready' ? catalog.data.games.map((g) => [g.id, g]) : [])
  const sold = soldSummary(items)
  const value = shelfValue(items, index)
  const nameOf = (l: ShelfLine) => byId.get(l.item.game_id)?.title ?? l.item.game_id
  // A store from before migration 0004 has no copy ids: it reads, it does not write.
  const writable = value.copies_supported
  const showPaid = writable && value.paid_supported

  // Copies of one game, oldest first, so a row can say which of them it is.
  const shelf = items.filter(onShelf).sort((a, b) => a.added_at.localeCompare(b.added_at))
  const copiesByGame = new Map<string, CollectionItem[]>()
  for (const item of shelf) copiesByGame.set(item.game_id, [...(copiesByGame.get(item.game_id) ?? []), item])
  const positionOf = (item: CollectionItem): string | null => {
    const list = copiesByGame.get(item.game_id) ?? []
    return list.length > 1 ? `copy ${list.indexOf(item) + 1} of ${list.length}` : null
  }
  const games = copiesByGame.size
  const gamesLabel = `${games} ${games === 1 ? 'game' : 'games'}`
  const countLabel = shelf.length === games ? gamesLabel : `${shelf.length} copies · ${gamesLabel}`
  const empty = shelf.length === 0

  return (
    <div className={cn('flex flex-col gap-4 lg:min-h-0 lg:flex-1', wide.layout)}>
      <div className={cn('flex flex-col gap-4', wide.main)}>
        <Window title="My collection" bodyClassName="p-0" stripe order={0} fill>
          <div className="bevel-in flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-[var(--border)] px-3 py-1.5">
            {writable ? <QuickAdd mode="own" variant="strip" /> : <span className="eyebrow">Read-only until migration 0004 is applied</span>}
            <p className="eyebrow whitespace-nowrap">
              {empty ? 'nothing on the shelf' : `${money(value.total_cents)} · ${countLabel} · ${value.priced} priced`}
            </p>
          </div>
          {/* The pane is a container: in a narrow window the row sheds its week column and a few words rather than a scroll bar. */}
          <WindowPane label="My collection" className="@container">
            {empty ? (
              <div className="p-4">
                <p className="pixel mb-2 text-[0.6rem]">Nothing on the shelf yet</p>
                <p className="max-w-md text-xs">
                  Type a title above, or open a game and mark it as owned with the condition of your copy. The shelf
                  value adds up what those copies are asking today.
                </p>
                <Link to="/" className={cn(shelfButton, 'mt-3')}>
                  Browse the boards
                </Link>
              </div>
            ) : (
              <table className={`w-full border-collapse ${showPaid ? 'min-w-[36rem] @min-[44rem]:min-w-[44rem]' : 'min-w-[30rem]'}`}>
                <thead>
                  <tr>
                    <th scope="col" className={cn(headCell, 'text-left')}>
                      <span className="eyebrow">Game</span>
                    </th>
                    {showPaid && (
                      <th scope="col" className={cn(headCell, 'text-right')}>
                        <span className="eyebrow">Paid</span>
                      </th>
                    )}
                    <th scope="col" className={cn(headCell, 'text-right')}>
                      <span className="eyebrow">Today</span>
                    </th>
                    {showPaid && (
                      <th scope="col" className={cn(headCell, 'text-right')}>
                        <span className="eyebrow">Gain</span>
                      </th>
                    )}
                    <th scope="col" className={cn(headCell, 'hidden text-right @min-[44rem]:table-cell')}>
                      <span className="eyebrow">7 days</span>
                    </th>
                    <th scope="col" className={cn(headCell, 'text-right')}>
                      <span className="eyebrow">Shelf</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {value.lines.map((l) => {
                    const id = l.item.game_id
                    const game = byId.get(id)
                    const position = positionOf(l.item)
                    return (
                      <tr key={l.item.id ?? id} className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]">
                        <td className="p-2">
                          <Link to={`/g/${id}`} className="text-xs font-semibold hover:text-[var(--primary)]">
                            {nameOf(l)}
                          </Link>
                          <p className="eyebrow mt-0.5">
                            {game ? PLATFORM_SHORT[game.platform] : 'no longer tracked'}
                            {position && ` · ${position}`}
                            {l.entry?.stale && ' · stale'}
                          </p>
                        </td>
                        {showPaid && (
                          <td className="p-2 text-right">
                            <PaidField copyId={l.item.id!} title={nameOf(l)} value={l.paid_cents} />
                          </td>
                        )}
                        <td className="p-2 text-right">
                          {/* The price is for the copy's condition, so the condition sits under it. */}
                          <div className="flex flex-col items-end">
                            <span className="tabular text-xs font-bold">{money(l.price_cents)}</span>
                            <span className="flex items-center gap-1.5">
                              <span className="h-1 w-4" style={{ background: conditionColor(l.item.condition) }} aria-hidden />
                              <span className="eyebrow">
                                <span className="sr-only">for a </span>
                                {CONDITION_LABELS[l.item.condition]}
                                <span className="sr-only"> copy</span>
                              </span>
                            </span>
                          </div>
                        </td>
                        {showPaid && (
                          <td className="p-2 text-right">
                            {l.gain_cents === null ? (
                              <span className="text-xs text-[var(--muted-foreground)]">—</span>
                            ) : (
                              <div className="flex flex-col items-end">
                                <span className="tabular text-xs font-bold" style={{ color: heat(l.gain_pct) }}>
                                  {signedMoney(l.gain_cents)}
                                </span>
                                {l.gain_pct !== null && (
                                  <span className="eyebrow">
                                    {pct(l.gain_pct)}
                                    <span className="hidden @min-[48rem]:inline"> vs paid</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                        <td className="hidden p-2 text-right @min-[44rem]:table-cell">
                          <TrendPill value={l.entry?.pct_7d ?? null} showIcon={false} />
                        </td>
                        <td className="p-2 text-right">
                          {writable && <ShelfRowControls gameId={id} title={nameOf(l)} copyId={l.item.id} />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <SoldWindow summary={sold} byId={byId} />
          </WindowPane>
        </Window>

        {!empty && (
          <p className="text-[0.7rem] text-[var(--card-foreground)]">
            <span className="window inline-block px-2 py-1">
              A dash means no listing in that condition cleared the four-listing minimum today. Gains compare that
              asking price with what you typed as paid, in the same dollars.
            </span>
          </p>
        )}
      </div>

      {!empty && (
        <div className={cn('flex flex-col gap-4', wide.side)}>
          <section aria-label="About this shelf">
            <About value={value} countLabel={countLabel} copies={shelf.length} writable={writable} items={items} />
          </section>
          <ShelfTimeline items={items} />
          {value.movers.length > 0 && (
            <Window title="What moved this week" order={2}>
              <ul className="divide-y divide-dotted divide-[var(--input)]">
                {value.movers.map((l) => (
                  <li key={l.item.game_id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <Link to={`/g/${l.item.game_id}`} className="font-semibold hover:text-[var(--primary)]">
                      {nameOf(l)}
                    </Link>
                    <span className="flex items-center gap-3">
                      <span className="tabular">{money(l.price_cents)}</span>
                      <TrendPill value={l.entry?.pct_7d ?? null} showIcon={false} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="eyebrow mt-3">7 day move of each game's headline price</p>
            </Window>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * About this shelf: what it adds up to, read against what it cost, and how
 * it splits by platform, in one window, the way About This Macintosh put the
 * machine's totals and its memory bars in one place.
 */
function About({
  value,
  countLabel,
  copies,
  writable,
  items,
}: {
  value: ShelfValue
  countLabel: string
  copies: number
  writable: boolean
  items: CollectionItem[]
}) {
  return (
    <Window title="About this shelf" stripe order={1}>
      <p className="eyebrow">Shelf value</p>
      <p className="tabular text-3xl font-bold">{money(value.total_cents)}</p>
      <p className="eyebrow mt-2">
        {countLabel} · {value.priced} priced · {value.unpriced} unpriced at their condition · asking prices, not appraisals
      </p>

      {/* The shelf read against what it cost, for the copies where both numbers exist. */}
      <div className="mt-4 border-t-2 border-dotted border-[var(--input)] pt-3">
        {!writable ? (
          <p className="text-xs">
            Copies need the database migration <code>supabase/migrations/0004_copies.sql</code>, which this copy has
            not applied yet. The shelf reads as before; nothing on it can be changed until then.
          </p>
        ) : !value.paid_supported ? (
          <p className="text-xs">
            Recording what you paid needs the database migration <code>supabase/migrations/0003_paid_price.sql</code>,
            which this copy has not applied yet.
          </p>
        ) : value.compared > 0 ? (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
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
            <p className="eyebrow pb-1">
              {value.compared} of {copies} compared
            </p>
          </div>
        ) : (
          <p className="text-xs">
            Type what you paid in the Paid column to read the shelf against it. A copy counts once it has both a paid
            price and a price today.
          </p>
        )}
      </div>

      <ShelfReport items={items} variant="section" />
    </Window>
  )
}
