import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useJson } from '@/lib/data'
import { conditionColor, formatDate, money } from '@/lib/format'
import {
  CONDITIONS,
  CONDITION_LABELS,
  PLATFORM_LABELS,
  type CatalogFile,
  type Condition,
  type HistoryFile,
  type LatestFile,
} from '@/lib/types'
import { TrendPill } from '@/components/TrendPill'
import { Window } from '@/components/Window'
import { CRTScreen } from '@/components/CRTScreen'
import { LoadError, Message } from '@/components/States'

const chip = 'bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-[0.6rem]'
const btn = 'press bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5'

export function Game() {
  const { id } = useParams()
  const [condition, setCondition] = useState<Condition>('cib')

  const history = useJson<HistoryFile>(id ? `history/${id}.json` : null)
  const catalog = useJson<CatalogFile>('catalog.json')

  const game = catalog.status === 'ready' ? catalog.data.games.find((g) => g.id === id) : undefined
  const board = useJson<LatestFile>(game ? `latest/${game.platform}.json` : null)
  const boardEntry = board.status === 'ready' ? board.data.games.find((g) => g.id === id) : undefined

  const series = useMemo(() => {
    if (history.status !== 'ready') return []
    return history.data.points
      .filter((p) => p[condition] != null)
      .map((p) => ({ date: p.d, cents: p[condition] as number }))
  }, [history, condition])

  if (!id) return <Message title="No game selected" detail="Pick a game from any board." />
  if (history.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (history.status === 'error') return <LoadError what="this game's history" />

  const annotation = game?.annotation
  const info = game?.info
  const specs: [string, string][] = [
    ['Developer', info?.developer ?? ''],
    ['Publisher', info?.publisher ?? ''],
    ['Released', info?.year ? String(info.year) : ''],
    ['Genre', info?.genre ?? ''],
  ].filter((row): row is [string, string] => row[1] !== '')

  const latest = history.data.points.at(-1)
  const available = CONDITIONS.filter((c) => history.data.points.some((p) => p[c] != null))
  const color = conditionColor(condition)

  return (
    <div className="space-y-4">
      <Window title={`${game?.title ?? id} — details`} stripe order={0}>
        <div className="grid gap-5 sm:grid-cols-[13rem_1fr]">
          <CRTScreen
            title={game?.title ?? String(id)}
            coverURL={info?.cover_url}
            platform={game ? PLATFORM_LABELS[game.platform] : ''}
            year={info?.year}
          />

          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="pixel text-base leading-snug sm:text-xl">{game?.title ?? id}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {game && <span className={chip}>{PLATFORM_LABELS[game.platform]}</span>}
                  {game && game.variant !== 'none' && <span className={chip}>{game.variant}</span>}
                  {game && <span className={chip}>{game.region}</span>}
                  {boardEntry?.stale && <span className={chip}>stale</span>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {game?.ebay_url && (
                  <a href={game.ebay_url} target="_blank" rel="noreferrer noopener" className={btn}>
                    Listings on eBay
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
                <Link to={game ? `/p/${game.platform}` : '/'} className={btn}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Back to board
                </Link>
              </div>
            </div>

            {specs.length > 0 && (
              <dl className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {specs.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-3 border-b border-dotted border-[var(--input)] py-1 text-[0.75rem]"
                  >
                    <dt className="opacity-70">{label}</dt>
                    <dd className="truncate font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {info?.trivia && (
              <p className="bevel-in mt-4 border-2 border-[var(--border)] p-2.5 text-[0.75rem]">
                <span className="eyebrow mr-1.5">Did you know</span>
                {info.trivia}
              </p>
            )}
          </div>
        </div>
      </Window>

      {info?.why && (
        <Window title="Why it costs what it costs" order={1}>
          <p className="text-[0.8rem] leading-relaxed">{info.why}</p>
          <p className="eyebrow mt-3">
            Written by a contributor · edit it in catalog/{game?.platform}.yaml
          </p>
        </Window>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CONDITIONS.map((c) => (
          <div key={c} className="window p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-1 w-4" style={{ background: conditionColor(c) }} aria-hidden />
              <span className="eyebrow">{CONDITION_LABELS[c]}</span>
            </div>
            <p className="tabular text-lg font-bold">{money(latest?.[c] ?? null)}</p>
          </div>
        ))}
        <div className="window p-3">
          <p className="eyebrow mb-2">7 day move</p>
          <TrendPill value={boardEntry?.pct_7d ?? null} />
        </div>
      </div>

      {annotation && (
        <Window title="Why it is moving — recent event" order={2}>
          <p className="eyebrow mb-2">{formatDate(annotation.date)}</p>
          <p className="text-xs">{annotation.note}</p>
          {annotation.source_url && (
            <a
              href={annotation.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex items-center gap-1 text-[0.7rem] underline"
            >
              Source
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </Window>
      )}

      <Window title="Price history" bodyClassName="p-4" order={3}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow">Condition</p>
            <div className="flex">
              {available.map((c) => (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  aria-pressed={condition === c}
                  className={`press border-2 border-[var(--border)] px-3 py-1.5 text-xs font-semibold ${
                    condition === c
                      ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]'
                      : 'bevel bg-[var(--secondary)] text-[var(--secondary-foreground)]'
                  }`}
                >
                  {CONDITION_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {series.length < 2 ? (
            <Message
              title="Not enough history yet"
              detail="This game needs a few more daily snapshots before a chart is meaningful."
            />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 4, right: 24, bottom: 0, left: 4 }}>
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
                    formatter={(v) => [money(Number(v)), CONDITION_LABELS[condition]]}
                  />
                  <Line
                    type="monotone"
                    dataKey="cents"
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: color }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
      </Window>
    </div>
  )
}
