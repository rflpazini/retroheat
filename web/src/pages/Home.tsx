import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { useJson } from '@/lib/data'
import { companions, conditionColor, heat, money } from '@/lib/format'
import {
  CONDITION_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_SHORT,
  type Platform,
  type TrendEntry,
  type TrendingFile,
} from '@/lib/types'
import { Sparkline } from '@/components/Sparkline'
import { TrendPill, TrendStatus } from '@/components/TrendPill'
import { Window, WindowPane } from '@/components/Window'
import { DiskWindow } from '@/components/DiskWindow'
import { OtherPrices } from '@/components/OtherPrices'
import { ShelfRowControls } from '@/components/ShelfControls'
import { menuBarClasses } from '@/components/retro-os/menu-bar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAccount } from '@/lib/account'
import { cn } from '@/lib/utils'

type MoveWindow = 'pct_1d' | 'pct_7d' | 'pct_30d'

const WINDOWS: [MoveWindow, string, string][] = [
  ['pct_1d', '1 day', 'over 1 day'],
  ['pct_7d', '7 days', 'over 7 days'],
  ['pct_30d', '30 days', 'over 30 days'],
]

/*
  The board's columns from the small breakpoint up. With accounts on, a last
  column holds the shelf keys at one width on every row, so they line up like
  a column of checkboxes instead of trailing each title.
*/
const boardColumns = {
  plain: 'sm:grid-cols-[2.5rem_1fr_7rem_7rem_6.5rem]',
  shelf: 'sm:grid-cols-[2.5rem_1fr_7rem_7rem_6.5rem_9.5rem]',
}

function Hero({ entry, move, className }: { entry: TrendEntry; move: MoveWindow; className?: string }) {
  const color = heat(entry[move])
  const over = WINDOWS.find(([key]) => key === move)?.[2] ?? ''

  return (
    <Window title="Now playing — hottest game on the shelf" stripe order={1} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow mb-2">{PLATFORM_LABELS[entry.platform]}</p>
          <Link to={`/g/${entry.id}`}>
            <h2 className="pixel text-lg leading-snug hover:text-[var(--primary)] sm:text-2xl">
              {entry.title}
            </h2>
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="tabular text-2xl font-bold">{money(entry.price_cents)}</span>
            <span className="eyebrow">{CONDITION_LABELS[entry.headline_condition]} copy</span>
            <TrendPill value={entry[move]} />
            <span className="text-xs">{over}</span>
          </div>
          <OtherPrices prices={entry.prices} headline={entry.headline_condition} className="mt-2" />
          <ShelfRowControls gameId={entry.id} title={entry.title} className="mt-4" />
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

function MoverRow({ entry, rank, move, shelf }: { entry: TrendEntry; rank: number; move: MoveWindow; shelf: boolean }) {
  const change = entry[move]

  return (
    <div
      className={`bevel grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-2 border-[var(--border)] bg-[var(--card)] p-2.5 ${
        shelf ? boardColumns.shelf : boardColumns.plain
      }`}
    >
      <span className="pixel text-[0.6rem] text-[var(--muted-foreground)]">
        {String(rank).padStart(2, '0')}
      </span>

      <div className="min-w-0">
        <Link to={`/g/${entry.id}`} className="text-sm font-semibold hover:text-[var(--primary)]">
          <span className="line-clamp-1">{entry.title}</span>
        </Link>
        <p className="eyebrow mt-0.5">
          {PLATFORM_SHORT[entry.platform]}
          {companions(entry.prices, entry.headline_condition).map(
            (o) => ` · ${CONDITION_LABELS[o.condition]} ${money(o.cents)}`,
          )}
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
        <p className="eyebrow">{CONDITION_LABELS[entry.headline_condition]}</p>
        <TrendPill value={change} showIcon={false} className="mt-1" />
      </div>

      {/* On a phone the keys drop under the title; from the small breakpoint they take the last column. */}
      {shelf && (
        <div className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto sm:justify-self-end">
          <ShelfRowControls gameId={entry.id} title={entry.title} />
        </div>
      )}
    </div>
  )
}

/** The longest window with at least one mover, or the week when nothing has moved. */
export function defaultWindow(entries: TrendEntry[]): MoveWindow {
  // A month never has data before a week does, so the week is the longest
  // window worth checking first.
  if (entries.some((e) => e.pct_7d != null)) return 'pct_7d'
  if (entries.some((e) => e.pct_1d != null)) return 'pct_1d'
  return 'pct_7d'
}

/*
  The shelf's controls sit on the window's own header strip, where a Finder
  window kept its view controls, as keys in the system's chrome: a menu for
  the platform and a row of window keys. The strip stays whatever the board
  below it shows, so an empty or unpriced board is never a dead end.
*/
const key =
  'press inline-flex h-7 shrink-0 items-center justify-center gap-1.5 border-2 border-[var(--border)] px-2.5 text-xs font-semibold outline-none'
const keyDown = 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]'
const keyUp = 'bevel bg-[var(--secondary)] text-[var(--secondary-foreground)]'

type Board = Platform | 'all'

function PlatformMenu({ value, onChange }: { value: Board; onChange: (b: Board) => void }) {
  const label = value === 'all' ? 'All platforms' : PLATFORM_LABELS[value]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(key, keyUp, 'w-[11rem] justify-between data-[popup-open]:bevel-in')}
        aria-label={`Platform: ${label}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuBarClasses.content}>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as Board)}>
          <DropdownMenuRadioItem value="all" closeOnClick className={cn(menuBarClasses.item, 'pr-7')}>
            All platforms
          </DropdownMenuRadioItem>
          {PLATFORMS.map((p) => (
            <DropdownMenuRadioItem key={p} value={p} closeOnClick className={cn(menuBarClasses.item, 'pr-7')}>
              {PLATFORM_LABELS[p]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Toolbar({
  platform,
  onPlatform,
  move,
  onMove,
}: {
  platform: Board
  onPlatform: (b: Board) => void
  move: MoveWindow
  onMove: (m: MoveWindow) => void
}) {
  return (
    <div className="bevel-in flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)] px-3 py-1.5">
      <PlatformMenu value={platform} onChange={onPlatform} />
      <div className="flex items-center gap-2">
        <span className="eyebrow">Window</span>
        <div className="flex" role="group" aria-label="Window">
          {WINDOWS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onMove(k)}
              aria-pressed={move === k}
              className={cn(key, move === k ? keyDown : keyUp, '-ml-0.5 first:ml-0')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A short note inside the pane, in place of rows. */
function Note({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="p-4">
      <p className="pixel mb-2 text-[0.6rem]">{title}</p>
      <p className="max-w-md text-xs">{detail}</p>
    </div>
  )
}

export function Home() {
  const [platform, setPlatform] = useState<Board>('all')
  const [chosen, setMove] = useState<MoveWindow | null>(null)

  const board = useJson<TrendingFile>(`trending/${platform}.json`)
  const shelf = useAccount().status !== 'disabled'

  // Until the reader picks a window the board opens on the longest one that
  // has movers. In the first week of collection only the 1 day window does,
  // and opening on an empty week would hide the moves that exist.
  const move: MoveWindow = chosen ?? defaultWindow(board.status === 'ready' ? board.data.entries : [])

  // The file holds the week's leaders plus today's biggest movers; sorting
  // by the chosen window gives each window its own board without a file per
  // window. Every mover with a value is shown: the shelf scrolls inside its
  // window, so the list's length no longer sets the page's.
  const entries = useMemo(() => {
    if (board.status !== 'ready') return []
    return [...board.data.entries]
      .filter((e) => e[move] != null)
      .sort((a, b) => (b[move] ?? -Infinity) - (a[move] ?? -Infinity))
  }, [board, move])

  const [top, ...rest] = entries
  const columns = shelf ? boardColumns.shelf : boardColumns.plain

  /*
    Stacked on a phone and a laptop: the hero, the shelf, the disk. On a wide
    desktop the hero steps aside into a column of its own, the way a "Get
    Info" panel sat beside a Finder window, and the shelf takes the height
    the hero was using.
  */
  return (
    <div className={cn('flex flex-col gap-4 lg:min-h-0 lg:flex-1', wide.layout)}>
      {top && <Hero entry={top} move={move} className={wide.hero} />}

      <div className={cn('flex flex-col gap-4 lg:min-h-0', wide.column)}>
      <Window title="The shelf — ranked by momentum" bodyClassName="p-0" order={top ? 2 : 0} fill>
        <Toolbar platform={platform} onPlatform={setPlatform} move={move} onMove={setMove} />
        <WindowPane label="The shelf">
          {board.status === 'loading' && <p className="pixel p-4 text-[0.6rem]">Reading disk…</p>}

          {board.status === 'error' &&
            (board.error === '404' && platform !== 'all' ? (
              // A board added to the catalog has no file until the collector has run once.
              <Note
                title="No prices yet"
                detail={`${PLATFORM_LABELS[platform]} was added to the catalog, but the collector has not priced it yet. It runs twice a day, so this board fills in after its next run.`}
              />
            ) : (
              <Note
                title="Could not load the trending board"
                detail="The data files are published by a scheduled job. If this is a fresh checkout, run the collector once to generate them."
              />
            ))}

          {board.status === 'ready' && entries.length === 0 && (
            <Note
              title="No movers yet"
              detail={
                move === 'pct_1d'
                  ? 'A one-day move needs two days of price history. The scheduled job runs twice a day, so this board fills in tomorrow.'
                  : `Momentum over ${move === 'pct_7d' ? 'a week' : 'a month'} needs that much price history. Until then, the 1 day window shows what moved today.`
              }
            />
          )}

          {entries.length > 0 && (
            <>
              {/* The column heads stay put while the rows scroll under them, as a Finder list's did. */}
              <div
                className={`sticky top-0 z-10 hidden gap-3 border-b-2 border-[var(--border)] bg-[var(--muted)] px-[1.375rem] py-1.5 sm:grid ${columns}`}
              >
                <span className="eyebrow">#</span>
                <span className="eyebrow">Game</span>
                <span className="eyebrow">Status</span>
                <span className="eyebrow">Trend</span>
                <span className="eyebrow text-right">Price</span>
                {shelf && <span className="eyebrow text-right">Shelf</span>}
              </div>
              <div className="space-y-2 p-3">
                {rest.map((entry, i) => (
                  <MoverRow key={entry.id} entry={entry} rank={i + 2} move={move} shelf={shelf} />
                ))}
              </div>
            </>
          )}
        </WindowPane>
      </Window>

      <DiskWindow order={3} />
      </div>
    </div>
  )
}

/* The two-column arrangement, from 88rem: wide enough for the shelf's columns beside an 18rem hero. */
const wide = {
  layout: 'min-[88rem]:grid min-[88rem]:grid-cols-[minmax(0,1fr)_18rem] min-[88rem]:grid-rows-[minmax(0,1fr)]',
  column: 'min-[88rem]:col-start-1 min-[88rem]:row-start-1',
  hero: 'min-[88rem]:col-start-2 min-[88rem]:row-start-1 min-[88rem]:self-start',
}
