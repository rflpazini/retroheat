import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useJsonMany } from '@/lib/data'
import { formatDate, money, moneyExact, pct, signedMoney } from '@/lib/format'
import type { CollectionItem } from '@/lib/shelf'
import { collectionTimeline } from '@/lib/timeline'
import type { HistoryFile } from '@/lib/types'
import { Window } from '@/components/Window'

/** The most copies whose histories the page will fetch for the line; beyond it the caption says so. */
export const TIMELINE_LIMIT = 300

/**
 * The shelf's asking value on every day the collector has priced it, as one
 * line, with what was paid as a flat rule to read it against. One small file
 * per owned game, all fetched together and cached with the rest of the data.
 */
export function ShelfTimeline({ items }: { items: CollectionItem[] }) {
  const charted = useMemo(() => items.slice(0, TIMELINE_LIMIT), [items])
  const files = useJsonMany<HistoryFile>(charted.map((i) => `history/${i.game_id}.json`))
  const timeline = useMemo(() => {
    if (files.status !== 'ready') return null
    // Keyed by the id we asked for, not the id the file claims.
    const histories = new Map<string, HistoryFile['points']>()
    for (const item of charted) {
      const file = files.data.get(`history/${item.game_id}.json`)
      if (file) histories.set(item.game_id, file.points)
    }
    return collectionTimeline(charted, histories)
  }, [files, charted])

  const first = timeline?.points[0]
  const last = timeline?.points.at(-1)
  const change = first && last && first !== last ? last.value_cents - first.value_cents : null
  const changePct = change !== null && first && first.value_cents > 0 ? (change / first.value_cents) * 100 : null

  return (
    <Window title="Shelf value over time" order={1}>
      {files.status === 'error' ? (
        <p className="text-xs font-semibold text-[var(--destructive)]" role="alert">
          The price history could not be loaded, so there is no line to draw: {files.error}
        </p>
      ) : files.status !== 'ready' || !timeline ? (
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      ) : timeline.points.length < 2 ? (
        <p className="max-w-xl text-xs">
          The line draws itself as days go by: the collector prices the boards twice a day, and this shelf has{' '}
          {timeline.points.length === 0 ? 'no day yet on which every copy had a price' : 'one such day so far'}.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="eyebrow">Since {formatDate(first!.date)}</p>
              <p className="flex items-center gap-2">
                <span className="tabular text-lg font-bold">{signedMoney(change)}</span>
                {changePct !== null && <span className="eyebrow">{pct(changePct)}</span>}
              </p>
            </div>
            <div>
              <p className="eyebrow">Asking today</p>
              <p className="tabular text-lg font-bold">{moneyExact(last!.value_cents)}</p>
            </div>
            {timeline.paid_covers > 0 && (
              <div>
                <p className="eyebrow">Paid for these copies</p>
                <p className="tabular text-lg font-bold">{moneyExact(timeline.paid_cents)}</p>
              </div>
            )}
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeline.points} margin={{ top: 4, right: 24, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={44}
                />
                <YAxis
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tickFormatter={(v: number) => money(v)}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    color: 'var(--popover-foreground)',
                  }}
                  labelStyle={{ color: 'var(--muted-foreground)' }}
                  formatter={(v) => [moneyExact(Number(v)), 'Shelf']}
                />
                {timeline.paid_covers > 0 && (
                  <ReferenceLine
                    y={timeline.paid_cents}
                    ifOverflow="extendDomain"
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{ value: 'Paid', position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 11 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="value_cents"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: 'var(--primary)' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {timeline && (
        <p className="mt-3 text-[0.65rem] text-[var(--muted-foreground)]">
          What today's shelf would have asked on each day, from the first day every copy had a price, each copy at
          its own condition and at its last known price. {timeline.priced} of {timeline.total} copies have a price
          history and are on the line
          {timeline.paid_covers > 0 && `; the paid line covers ${timeline.paid_covers} of those ${timeline.priced}`}
          {items.length > TIMELINE_LIMIT && `; only the first ${TIMELINE_LIMIT} copies are charted`}.
        </p>
      )}
    </Window>
  )
}
