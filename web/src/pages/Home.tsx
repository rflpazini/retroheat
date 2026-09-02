import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useJson } from '@/lib/data'
import { conditionColor, heat, money } from '@/lib/format'
import {
  CONDITION_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  type TrendEntry,
  type TrendingFile,
} from '@/lib/types'
import { Sparkline } from '@/components/Sparkline'
import { TrendPill, TrendStatus } from '@/components/TrendPill'
import { Window } from '@/components/Window'
import { DiskWindow } from '@/components/DiskWindow'
import { LoadError, Message } from '@/components/States'

type MoveWindow = 'pct_1d' | 'pct_7d' | 'pct_30d'

const WINDOWS: [MoveWindow, string, string][] = [
  ['pct_1d', '1 day', 'over 1 day'],
  ['pct_7d', '7 days', 'over 7 days'],
  ['pct_30d', '30 days', 'over 30 days'],
]

/** How many movers the shelf lists after sorting by the chosen window. */
const SHELF_SIZE = 20

function Hero({ entry, move }: { entry: TrendEntry; move: MoveWindow }) {
  const color = heat(entry[move])
  const over = WINDOWS.find(([key]) => key === move)?.[2] ?? ''

  return (
    <Window title="Now playing — hottest game on the shelf" stripe order={1}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow mb-2">
            {PLATFORM_LABELS[entry.platform]} · {CONDITION_LABELS[entry.headline_condition]}
          </p>
          <Link to={`/g/${entry.id}`}>
            <h2 className="pixel text-lg leading-snug hover:text-[var(--primary)] sm:text-2xl">
              {entry.title}
            </h2>
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="tabular text-2xl font-bold">{money(entry.price_cents)}</span>
            <TrendPill value={entry[move]} />
            <span className="text-xs">{over}</span>
          </div>
          {entry.annotation && (
            <p className="bevel-in mt-4 max-w-xl border-2 border-[var(--border)] p-2 text-xs">
              <span className="eyebrow mr-1">Why:</span>
              {entry.annotation.note}
            </p>
          )}
        </div>

        <div className="bevel-in border-2 border-[var(--border)] bg-[var(--muted)] p-2">
          <Sparkline values={entry.spark} color={color} width={220} height={76} />
        </div>
      </div>
    </Window>
  )
}

function MoverRow({ entry, rank, move }: { entry: TrendEntry; rank: number; move: MoveWindow }) {
  const change = entry[move]

  return (
    <div className="bevel grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-2 border-[var(--border)] bg-[var(--card)] p-2.5 sm:grid-cols-[2.5rem_1fr_7rem_7rem_6.5rem]">
      <span className="pixel text-[0.6rem] text-[var(--muted-foreground)]">
        {String(rank).padStart(2, '0')}
      </span>

      <div className="min-w-0">
        <Link to={`/g/${entry.id}`} className="text-sm font-semibold hover:text-[var(--primary)]">
          <span className="line-clamp-1">{entry.title}</span>
        </Link>
        <p className="eyebrow mt-0.5">
          {PLATFORM_SHORT[entry.platform]} · {CONDITION_LABELS[entry.headline_condition]}
          {entry.annotation && ' · has context'}
        </p>
      </div>

      <div className="hidden sm:block">
        <TrendStatus value={change} />
      </div>

      <Sparkline
        values={entry.spark}
        color={conditionColor(entry.headline_condition)}
        className="hidden sm:block"
        width={100}
        height={28}
      />

      <div className="text-right">
        <p className="tabular text-sm font-bold">{money(entry.price_cents)}</p>
        <TrendPill value={change} showIcon={false} className="mt-1" />
      </div>
    </div>
  )
}

export function Home() {
  const [platform, setPlatform] = useState<string>('all')
  const [move, setMove] = useState<MoveWindow>('pct_7d')

  const board = useJson<TrendingFile>(`trending/${platform}.json`)

  // The file holds the week's leaders plus today's biggest movers; sorting
  // by the chosen window and cutting to the shelf size gives each window its
  // own board without a file per window.
  const entries = useMemo(() => {
    if (board.status !== 'ready') return []
    return [...board.data.entries]
      .filter((e) => e[move] != null)
      .sort((a, b) => (b[move] ?? -Infinity) - (a[move] ?? -Infinity))
      .slice(0, SHELF_SIZE)
  }, [board, move])

  if (board.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (board.status === 'error') return <LoadError what="the trending board" />

  const [top, ...rest] = entries

  return (
    <div className="space-y-4">
      <Window title="Filters" bodyClassName="p-3" order={0}>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="eyebrow mb-1.5 block">Platform</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="bevel-in border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
            >
              <option value="all">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="eyebrow mb-1.5 block">Window</span>
            <div className="flex">
              {WINDOWS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMove(key)}
                  aria-pressed={move === key}
                  className={cnBtn(move === key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Window>

      {entries.length === 0 ? (
        <Message
          title="No movers yet"
          detail={
            move === 'pct_1d'
              ? 'A one-day move needs two days of price history. The scheduled job runs twice a day, so this board fills in tomorrow.'
              : `Momentum over ${move === 'pct_7d' ? 'a week' : 'a month'} needs that much price history. Until then, the 1 day window shows what moved today.`
          }
        />
      ) : (
        <>
          <Hero entry={top} move={move} />

          <Window title="The shelf — ranked by momentum" bodyClassName="p-3" order={2}>
            <div className="mb-2 hidden grid-cols-[2.5rem_1fr_7rem_7rem_6.5rem] gap-3 px-2.5 sm:grid">
              <span className="eyebrow">#</span>
              <span className="eyebrow">Game</span>
              <span className="eyebrow">Status</span>
              <span className="eyebrow">Trend</span>
              <span className="eyebrow text-right">Price</span>
            </div>
            <div className="space-y-2">
              {rest.map((entry, i) => (
                <MoverRow key={entry.id} entry={entry} rank={i + 2} move={move} />
              ))}
            </div>
          </Window>
        </>
      )}

      <DiskWindow order={3} />
    </div>
  )
}

function cnBtn(active: boolean) {
  return [
    'press border-2 border-[var(--border)] px-3 py-1.5 text-xs font-semibold',
    active
      ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]'
      : 'bevel bg-[var(--secondary)] text-[var(--secondary-foreground)]',
  ].join(' ')
}
