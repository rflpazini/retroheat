import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useJson } from '@/lib/data'
import { conditionColor, money } from '@/lib/format'
import {
  CONDITIONS,
  CONDITION_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  type Condition,
  type LatestFile,
  type LatestGame,
  type Platform as PlatformID,
} from '@/lib/types'
import { Sparkline } from '@/components/Sparkline'
import { TrendPill, TrendStatus } from '@/components/TrendPill'
import { Window } from '@/components/Window'
import { LoadError, Message } from '@/components/States'

type SortKey = 'title' | 'loose' | 'cib' | 'new' | 'pct_1d' | 'pct_7d' | 'pct_30d'

const columns: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'title', label: 'Game', numeric: false },
  { key: 'loose', label: 'Loose', numeric: true },
  { key: 'cib', label: 'Complete', numeric: true },
  { key: 'new', label: 'Sealed', numeric: true },
  { key: 'pct_1d', label: '1 day', numeric: true },
  { key: 'pct_7d', label: '7 days', numeric: true },
  { key: 'pct_30d', label: '30 days', numeric: true },
]

function valueOf(game: LatestGame, key: SortKey): number | string | null {
  switch (key) {
    case 'title':
      return game.title
    case 'loose':
      return game.prices.loose?.median_cents ?? null
    case 'cib':
      return game.prices.cib?.median_cents ?? null
    case 'new':
      return game.prices.new?.median_cents ?? null
    case 'pct_1d':
      return game.pct_1d ?? null
    case 'pct_7d':
      return game.pct_7d
    case 'pct_30d':
      return game.pct_30d
  }
}

export function isPlatform(value: string | undefined): value is PlatformID {
  return !!value && (PLATFORMS as readonly string[]).includes(value)
}

export function sortGames(games: LatestGame[], key: SortKey, desc: boolean): LatestGame[] {
  return [...games].sort((a, b) => {
    const av = valueOf(a, key)
    const bv = valueOf(b, key)
    if (av === null && bv === null) return a.title.localeCompare(b.title)
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'string' || typeof bv === 'string') {
      const cmp = String(av).localeCompare(String(bv))
      return desc ? -cmp : cmp
    }
    return desc ? bv - av : av - bv
  })
}

function PriceCell({ game, condition }: { game: LatestGame; condition: Condition }) {
  const price = game.prices[condition]
  const spark = game.sparks?.[condition] ?? []

  if (!price) return <span className="text-xs text-[var(--muted-foreground)]">—</span>

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="tabular text-xs font-bold">{money(price.median_cents)}</span>
      {price.mode_cents ? (
        <span className="tabular text-[0.6rem] leading-none text-[var(--muted-foreground)]">
          mode {money(price.mode_cents)}
        </span>
      ) : null}
      <Sparkline values={spark} color={conditionColor(condition)} width={84} height={24} />
    </div>
  )
}

export function Platform() {
  const { platform } = useParams()
  const [sort, setSort] = useState<SortKey>('pct_7d')
  const [desc, setDesc] = useState(true)

  const valid = isPlatform(platform)
  const file = useJson<LatestFile>(valid ? `latest/${platform}.json` : null)

  const games = useMemo(
    () => (file.status === 'ready' ? sortGames(file.data.games, sort, desc) : []),
    [file, sort, desc],
  )

  if (!valid) {
    return <Message title="Unknown platform" detail="Pick one of the boards from the navigation." />
  }
  if (file.status === 'loading') {
    return (
      <Window title="Loading…">
        <p className="pixel text-[0.6rem]">Reading disk…</p>
      </Window>
    )
  }
  if (file.status === 'error') return <LoadError what={`the ${platform} board`} />

  function toggle(key: SortKey) {
    if (key === sort) {
      setDesc((d) => !d)
    } else {
      setSort(key)
      setDesc(key !== 'title')
    }
  }

  return (
    <div className="space-y-4">
      <Window
        title={`${PLATFORM_LABELS[platform as PlatformID]} — price board`}
        bodyClassName="p-0"
        stripe
        order={0}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] p-3">
          <p className="eyebrow">
            {file.data.games.length} games · median and mode asking price · as of {file.data.as_of}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {CONDITIONS.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="h-1 w-4"
                  style={{ background: conditionColor(c) }}
                  aria-hidden
                />
                <span className="eyebrow">{CONDITION_LABELS[c]}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead>
              <tr className="border-b-2 border-[var(--border)] bg-[var(--muted)]">
                {columns.map((c) => {
                  const active = sort === c.key
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
                      className={`p-2 ${c.numeric ? 'text-right' : 'text-left'}`}
                    >
                      <button
                        onClick={() => toggle(c.key)}
                        className={`eyebrow inline-flex items-center gap-1 ${
                          active ? 'text-[var(--primary)]' : ''
                        }`}
                      >
                        {c.label}
                        {active && <span aria-hidden>{desc ? '▼' : '▲'}</span>}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className="p-2 text-right">
                  <span className="eyebrow">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr
                  key={g.id}
                  className="border-b border-[var(--input)] last:border-0 hover:bg-[var(--secondary)]"
                >
                  <td className="p-2">
                    <Link
                      to={`/g/${g.id}`}
                      className="text-xs font-semibold hover:text-[var(--primary)]"
                    >
                      {g.title}
                    </Link>
                    <p className="eyebrow mt-0.5">
                      {g.variant !== 'none' ? g.variant : g.region}
                      {g.stale && ' · stale'}
                    </p>
                  </td>
                  {CONDITIONS.map((c) => (
                    <td key={c} className="p-2">
                      <div className="flex justify-end">
                        <PriceCell game={g} condition={c} />
                      </div>
                    </td>
                  ))}
                  <td className="p-2 text-right">
                    <TrendPill value={g.pct_1d ?? null} showIcon={false} />
                  </td>
                  <td className="p-2 text-right">
                    <TrendPill value={g.pct_7d} showIcon={false} />
                  </td>
                  <td className="p-2 text-right">
                    <TrendPill value={g.pct_30d} showIcon={false} />
                  </td>
                  <td className="p-2 text-right">
                    <TrendStatus value={g.pct_7d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>

      <p className="text-[0.7rem] text-[var(--card-foreground)]">
        <span className="window inline-block px-2 py-1">
          A dash means no listing of that condition cleared the four-listing minimum.
        </span>
      </p>
    </div>
  )
}
