import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SpotlightItem {
  id: string
  title: string
  /** A second line under the title. */
  subtitle?: React.ReactNode
  /** Extra words the item answers to besides its title. */
  keywords?: string[]
  /** Items are listed under a heading when the group changes. */
  group?: string
  /** Shown in the leading box when there is no image. */
  icon?: React.ReactNode
  image?: string
  /** Right-aligned content: a price, a shortcut, a badge. */
  trailing?: React.ReactNode
  /** Listed when nothing has been typed yet. */
  pinned?: boolean
  /** Extra data-* attributes on the option, for styling or tests. */
  data?: Record<string, string>
}

interface SpotlightProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SpotlightItem[]
  onSelect: (item: SpotlightItem) => void
  /** Replace the built-in ranking. Return items in display order. */
  search?: (query: string, items: SpotlightItem[]) => SpotlightItem[]
  /** Window title. */
  title?: string
  /** Accessible name of the dialog. */
  label?: string
  /** Accessible name of the text field. */
  inputLabel?: string
  placeholder?: string
  /** Most results the built-in ranking returns. */
  limit?: number
  /** Footer text while nothing is typed. */
  hint?: React.ReactNode
  /** Footer text while something is typed. */
  status?: (shown: SpotlightItem[], query: string) => React.ReactNode
  /** Shown when a query matches nothing. */
  empty?: (query: string) => React.ReactNode
  /** Shows a loading row while items are still being fetched. */
  loading?: boolean
  /** A message above the results, for errors. */
  notice?: React.ReactNode
}

/** The key combination as the current machine writes it. */
export function shortcutLabel(key = 'K'): string {
  const ua = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`
  return /Mac|iPhone|iPad/.test(ua) ? `⌘${key}` : `Ctrl ${key}`
}

/**
 * useSpotlightShortcut runs toggle on Cmd+K (Ctrl+K elsewhere). It fires from
 * anywhere on the page, including inside the palette's own input, so the same
 * keys close it again.
 */
export function useSpotlightShortcut(toggle: () => void, key = 'k') {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, key])
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The built-in ranking: plain prefix and word matching people can predict.
 * Tiers, best first: the whole title, the start of the title, the start of a
 * word in it, every query word starting some title word, the title's
 * initials, any substring, then a keyword match.
 */
export function scoreItem(query: string, item: SpotlightItem): number {
  const q = fold(query)
  if (!q) return item.pinned ? 1 : 0
  const title = fold(item.title)
  const words = q.split(' ')
  const titleWords = title.split(' ')

  if (title === q) return 100
  if (title.startsWith(q)) return 90
  if (title.includes(` ${q}`)) return 80
  if (words.every((w) => titleWords.some((t) => t.startsWith(w)))) return 70
  if (words.length === 1 && q.length >= 3 && titleWords.map((w) => w[0]).join('').startsWith(q)) return 60
  if (title.includes(q)) return 50

  const keywords = (item.keywords ?? []).map(fold).join(' ').split(' ')
  if (words.every((w) => keywords.some((k) => k.startsWith(w)))) return 40
  return 0
}

export function rankItems(query: string, items: SpotlightItem[], limit = 10): SpotlightItem[] {
  if (!fold(query)) return items.filter((i) => i.pinned)
  return items
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length)
    .slice(0, limit)
    .map((h) => h.item)
}

/**
 * Spotlight: a search palette in a System 7 window, opened with Cmd+K or a
 * button of your own. Type to filter, arrow keys move, Enter selects, Escape
 * closes. Items may carry an image or icon, a subtitle and trailing content,
 * and are listed under group headings.
 *
 * Not built on a dialog primitive: a menu bar's focus restore and a
 * primitive's focus trap fight each other, and the palette needs only
 * Escape, a focus trap and a backdrop.
 */
export function Spotlight({
  open,
  onOpenChange,
  items,
  onSelect,
  search,
  title = 'Spotlight',
  label = 'Search',
  inputLabel = 'Search',
  placeholder = 'Search…',
  limit = 10,
  hint = 'Type to search',
  status = (shown) => `${shown.length} result${shown.length === 1 ? '' : 's'}`,
  empty = (q) => (
    <>
      Nothing called <strong>“{q}”</strong>.
    </>
  ),
  loading = false,
  notice,
}: SpotlightProps) {
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

  const trimmed = query.trim()
  const shown = useMemo(
    () => (search ? search(trimmed, items) : rankItems(trimmed, items, limit)),
    [search, trimmed, items, limit],
  )

  // Keep the highlight on a real row as the list changes under it.
  const current = Math.min(active, Math.max(shown.length - 1, 0))

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    // jsdom has no scrollIntoView; browsers do.
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [current, shown])

  function choose(item: SpotlightItem) {
    onOpenChange(false)
    onSelect(item)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(shown.length ? (current + 1) % shown.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(shown.length ? (current - 1 + shown.length) % shown.length : 0)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(shown.length - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = shown[current]
      if (item) choose(item)
    }
  }

  if (!open) return null

  const activeId = shown[current] ? `spotlight-option-${current}` : undefined

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh] sm:pt-[14vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="window animate-window relative flex w-full max-w-xl flex-col"
        style={{ maxHeight: 'min(70vh, 34rem)' }}
      >
        <div className="window-title flex items-center gap-2 px-2 py-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="title-box press shrink-0"
            aria-label="Close search"
          />
          <span className="flex min-w-0 flex-1 justify-center">
            <span className="window-title-text pixel truncate text-[0.5rem] uppercase">{title}</span>
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
            aria-label={inputLabel}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:opacity-50 sm:text-lg"
            placeholder={placeholder}
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
          {notice && (
            <li className="px-3 py-3 text-xs" role="presentation">
              {notice}
            </li>
          )}
          {loading && trimmed && (
            <li className="eyebrow px-3 py-3" role="presentation">
              Loading<span className="blink">_</span>
            </li>
          )}
          {!loading && !notice && trimmed && shown.length === 0 && (
            <li className="px-3 py-3 text-xs" role="presentation">
              {empty(trimmed)}
            </li>
          )}
          {shown.map((item, i) => {
            const selected = i === current
            const heading = item.group && (i === 0 || shown[i - 1].group !== item.group)
            const dataAttrs = Object.fromEntries(
              Object.entries(item.data ?? {}).map(([k, v]) => [`data-${k}`, v]),
            )
            return (
              <Fragment key={item.id}>
                {heading && (
                  <li className="eyebrow px-3 pt-2 pb-1" role="presentation">
                    {item.group}
                  </li>
                )}
                <li
                  id={`spotlight-option-${i}`}
                  role="option"
                  aria-selected={selected}
                  data-index={i}
                  {...dataAttrs}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-2 py-1.5',
                    selected && 'bg-[var(--foreground)] text-[var(--card)]',
                  )}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  {item.image ? (
                    <span
                      className={cn(
                        'bevel-in flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden border border-[var(--border)]',
                        selected ? 'bg-[var(--card)]' : 'bg-[var(--secondary)]',
                      )}
                      aria-hidden
                    >
                      <img src={item.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </span>
                  ) : item.icon !== undefined ? (
                    <span
                      className={cn(
                        'flex h-10 w-8 shrink-0 items-center justify-center',
                        item.subtitle !== undefined &&
                          cn(
                            'bevel-in overflow-hidden border border-[var(--border)]',
                            selected ? 'bg-[var(--card)] text-[var(--foreground)]' : 'bg-[var(--secondary)]',
                          ),
                      )}
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    {item.subtitle !== undefined && (
                      <span className={cn('eyebrow block truncate', selected && 'text-[var(--card)] opacity-80')}>
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  {item.trailing !== undefined && (
                    <span className={cn('shrink-0 text-right', selected && '[&_.eyebrow]:text-[var(--card)] [&_.eyebrow]:opacity-80')}>
                      {item.trailing}
                    </span>
                  )}
                  {selected && <CornerDownLeft className="size-3.5 shrink-0 opacity-70" aria-hidden />}
                </li>
              </Fragment>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--border)] px-3 py-1.5">
          <span className="eyebrow min-w-0 truncate">{trimmed ? status(shown, trimmed) : hint}</span>
          <span className="eyebrow hidden shrink-0 sm:block">↑↓ move · ↵ open · esc close</span>
        </div>
      </div>
    </div>
  )
}
