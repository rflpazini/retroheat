import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Gamepad2, Search, TrendingUp, Info } from 'lucide-react'
import { useJson } from '@/lib/data'
import { headlinePrice, money } from '@/lib/format'
import { rank, rankBoards, type Board } from '@/lib/search'
import {
  CONDITION_LABELS,
  PLATFORMS,
  PLATFORM_SHORT,
  type CatalogFile,
  type CatalogGame,
  type LatestFile,
  type LatestGame,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const LIMIT = 10

/** The key combination as the current machine writes it. */
export function shortcutLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`
  return /Mac|iPhone|iPad/.test(ua) ? '⌘K' : 'Ctrl K'
}

/**
 * useSpotlightShortcut opens the palette on Cmd+K (Ctrl+K elsewhere). It is
 * a toggle, so the same keys close it again, and it fires from anywhere on
 * the page including inside the palette's own input.
 */
export function useSpotlightShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
}

/**
 * Every platform's latest board, so a result can show its price. Six small
 * files; they are cached after the first open and shared with the boards.
 */
function useLatestIndex(enabled: boolean): Map<string, LatestGame> {
  // Fixed-length list of hooks: PLATFORMS is a constant.
  const boards = PLATFORMS.map((p) => useJson<LatestFile>(enabled ? `latest/${p}.json` : null))
  return useMemo(() => {
    const m = new Map<string, LatestGame>()
    for (const b of boards) {
      if (b.status !== 'ready') continue
      for (const g of b.data.games) m.set(g.id, g)
    }
    return m
  }, boards)
}

type Row =
  | { kind: 'game'; key: string; game: CatalogGame; to: string }
  | { kind: 'board'; key: string; board: Board; to: string }

function boardIcon(to: string) {
  if (to === '/') return TrendingUp
  if (to === '/about') return Info
  return Gamepad2
}

/**
 * Spotlight: a search palette over the whole shelf, opened with Cmd+K or the
 * magnifier in the menu bar. Type part of a title, its initials, or a title
 * plus a platform ("bully ps2"); arrow keys move, Enter opens the game.
 *
 * Like the About window this is not built on a dialog primitive, for the same
 * reason: the menu bar's focus handling and a primitive's focus trap fight,
 * and the palette needs only Escape, a focus trap and a backdrop.
 */
export function Spotlight({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const catalog = useJson<CatalogFile>(open ? 'catalog.json' : null)
  const prices = useLatestIndex(open)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    setQuery('')
    setActive(0)
    inputRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus()
    }
  }, [open, onOpenChange])

  const games = catalog.status === 'ready' ? catalog.data.games : []
  const total = games.length

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim()
    const out: Row[] = []
    if (trimmed) {
      for (const h of rank(trimmed, games, LIMIT)) {
        out.push({ kind: 'game', key: h.item.id, game: h.item, to: `/g/${h.item.id}` })
      }
    }
    // Boards come after games; with nothing typed they are the whole list.
    for (const b of rankBoards(trimmed)) {
      out.push({ kind: 'board', key: b.to, board: b, to: b.to })
    }
    return out
  }, [query, games])

  // Keep the highlight on a real row as the list changes under it.
  const current = Math.min(active, Math.max(rows.length - 1, 0))

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    // jsdom has no scrollIntoView; browsers do.
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [current, rows])

  function go(row: Row) {
    onOpenChange(false)
    navigate(row.to)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(rows.length ? (current + 1) % rows.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(rows.length ? (current - 1 + rows.length) % rows.length : 0)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(rows.length - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[current]
      if (row) go(row)
    }
  }

  if (!open) return null

  const trimmed = query.trim()
  const gameRows = rows.filter((r) => r.kind === 'game').length
  const firstBoard = rows.findIndex((r) => r.kind === 'board')
  const activeId = rows[current] ? `spotlight-option-${current}` : undefined

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh] sm:pt-[14vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the shelf"
        className="window animate-window relative flex w-full max-w-xl flex-col"
        style={{ maxHeight: 'min(70vh, 34rem)' }}
      >
        <div className="window-title flex items-center gap-2 px-2 py-1">
          <button
            onClick={() => onOpenChange(false)}
            className="title-box press shrink-0"
            aria-label="Close search"
          />
          <span className="flex min-w-0 flex-1 justify-center">
            <span className="window-title-text pixel truncate text-[0.5rem] uppercase">Spotlight</span>
          </span>
          <span className="title-box shrink-0" aria-hidden />
        </div>
        <div className="stripe" aria-hidden />

        <div className="flex items-center gap-3 border-b-2 border-[var(--border)] px-3 py-2.5">
          <Search className="size-4 shrink-0 opacity-70" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="spotlight-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search games"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:opacity-50 sm:text-lg"
            placeholder="Search a game title…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="bevel hidden shrink-0 border border-[var(--border)] bg-[var(--secondary)] px-1.5 py-0.5 text-[0.6rem] sm:block">
            esc
          </kbd>
        </div>

        <ul
          id="spotlight-results"
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto p-1"
        >
          {catalog.status === 'loading' && trimmed && (
            <li className="eyebrow px-3 py-3" role="presentation">
              Loading catalog<span className="blink">_</span>
            </li>
          )}
          {catalog.status === 'error' && (
            <li className="px-3 py-3 text-xs" role="presentation">
              The catalog could not be loaded. Reload and try again.
            </li>
          )}
          {catalog.status === 'ready' && trimmed && gameRows === 0 && (
            <li className="px-3 py-3 text-xs" role="presentation">
              No game called <strong>“{trimmed}”</strong> on the shelf. {total} titles are tracked;
              add a platform to narrow, for example <em>bully ps2</em>.
            </li>
          )}
          {gameRows > 0 && (
            <li className="eyebrow px-3 pt-2 pb-1" role="presentation">
              Games
            </li>
          )}
          {rows.map((row, i) => (
            <Fragment key={row.key}>
              {row.kind === 'board' && i === firstBoard && (
                <li className="eyebrow px-3 pt-2 pb-1" role="presentation">
                  Go to
                </li>
              )}
              <li
                id={`spotlight-option-${i}`}
                role="option"
                aria-selected={i === current}
                data-index={i}
                data-kind={row.kind}
                data-platform={row.kind === 'game' ? row.game.platform : undefined}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-2 py-1.5',
                  i === current && 'bg-[var(--foreground)] text-[var(--card)]',
                )}
                onMouseMove={() => setActive(i)}
                onClick={() => go(row)}
              >
                {row.kind === 'game' ? (
                  <GameRow game={row.game} price={prices.get(row.game.id)} selected={i === current} />
                ) : (
                  <BoardRow board={row.board} />
                )}
                {i === current && <CornerDownLeft className="size-3.5 shrink-0 opacity-70" aria-hidden />}
              </li>
            </Fragment>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--border)] px-3 py-1.5">
          <span className="eyebrow min-w-0 truncate">
            {trimmed && catalog.status === 'ready'
              ? `${gameRows} of ${total} titles`
              : 'Type a title, or title + platform'}
          </span>
          <span className="eyebrow hidden shrink-0 sm:block">↑↓ move · ↵ open · esc close</span>
        </div>
      </div>
    </div>
  )
}

function GameRow({
  game,
  price,
  selected,
}: {
  game: CatalogGame
  price: LatestGame | undefined
  selected: boolean
}) {
  const headline = price ? headlinePrice(price.prices) : null
  const meta = [PLATFORM_SHORT[game.platform], game.info?.year, game.info?.developer]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <span
        className={cn(
          'bevel-in flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden border border-[var(--border)]',
          selected ? 'bg-[var(--card)]' : 'bg-[var(--secondary)]',
        )}
        aria-hidden
      >
        {game.info?.cover_url ? (
          <img
            src={game.info.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="pixel text-[0.4rem] text-[var(--foreground)]">{PLATFORM_SHORT[game.platform]}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{game.title}</span>
        <span className={cn('eyebrow block truncate', selected && 'text-[var(--card)] opacity-80')}>{meta}</span>
      </span>
      <span className="shrink-0 text-right">
        {headline ? (
          <>
            <span className="tabular block text-sm font-semibold">{money(headline.cents)}</span>
            <span className={cn('eyebrow block', selected && 'text-[var(--card)] opacity-80')}>
              {CONDITION_LABELS[headline.condition]}
            </span>
          </>
        ) : (
          <span className={cn('eyebrow block', selected && 'text-[var(--card)] opacity-80')}>
            {price ? 'unpriced' : ''}
          </span>
        )}
      </span>
    </>
  )
}

function BoardRow({ board }: { board: Board }) {
  const Icon = boardIcon(board.to)
  return (
    <>
      <span className="flex h-10 w-8 shrink-0 items-center justify-center" aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{board.label}</span>
    </>
  )
}
