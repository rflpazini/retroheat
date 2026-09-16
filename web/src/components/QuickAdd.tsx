import { useMemo, useState } from 'react'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { rank } from '@/lib/search'
import { CONDITIONS, CONDITION_LABELS, PLATFORM_SHORT, type CatalogFile, type CatalogGame, type Condition } from '@/lib/types'
import { shelfButton } from '@/components/ShelfControls'
import { Window } from '@/components/Window'

const field = 'bevel-in w-full border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs outline-none'
const stripField = 'bevel-in h-7 w-full border-2 border-[var(--border)] bg-[var(--card)] px-2 text-xs outline-none placeholder:text-[var(--muted-foreground)]'
const toggle = (active: boolean) =>
  `press border-2 border-[var(--border)] px-2 py-1 text-[0.7rem] font-semibold ${
    active ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bevel bg-[var(--secondary)]'
  }`

/**
 * Fill a shelf without opening every game: type a title, pick a condition,
 * done. Same ranking as the search palette, so "bully ps2" works here too.
 * Owning adds a copy each time, which is how a second cart of the same game
 * gets on the shelf; the keys show the conditions already held. As a window
 * it stands on its own; as a strip it sits on another window's header, the
 * way a Finder window carried its find field.
 */
export function QuickAdd({ mode, variant = 'window' }: { mode: 'save' | 'own'; variant?: 'window' | 'strip' }) {
  const account = useAccount()
  const catalog = useJson<CatalogFile>('catalog.json')
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<string | null>(null)

  const games = catalog.status === 'ready' ? catalog.data.games : []
  const hits = useMemo(() => (query.trim() ? rank(query, games, 6) : []), [query, games])
  const label = mode === 'own' ? 'Add a game you own' : 'Save a game'

  async function add(g: CatalogGame, condition?: Condition) {
    if (mode === 'own') await account.addCopy(g.id, condition ?? 'cib')
    else if (!account.isSaved(g.id)) await account.toggleSaved(g.id)
    setAdded(g.title)
    setQuery('')
  }

  const results = (
    <>
      {hits.length > 0 && (
        <ul className="divide-y divide-dotted divide-[var(--input)]" aria-label="Matching games">
          {hits.map(({ item: g }) => {
            const held = new Set(account.copiesOf(g.id).map((c) => c.condition))
            const saved = account.isSaved(g.id)
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                <span>
                  <span className="font-semibold">{g.title}</span>
                  <span className="eyebrow ml-2">{PLATFORM_SHORT[g.platform]}</span>
                  {held.size > 0 && <span className="eyebrow ml-2">on the shelf</span>}
                </span>
                {mode === 'own' ? (
                  <span className="flex" role="group" aria-label={`Add ${g.title} as`}>
                    {CONDITIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={toggle(held.has(c))}
                        aria-pressed={held.has(c)}
                        onClick={() => void add(g, c)}
                      >
                        {CONDITION_LABELS[c]}
                      </button>
                    ))}
                  </span>
                ) : (
                  <button type="button" className={shelfButton} disabled={saved} onClick={() => void add(g)}>
                    {saved ? 'Saved' : 'Save'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {query.trim() && hits.length === 0 && catalog.status === 'ready' && (
        <p className="eyebrow">No tracked game matches “{query}”.</p>
      )}
      {added && !query && (
        <p className="text-xs" role="status">
          Added <strong>{added}</strong> to your {mode === 'own' ? 'collection' : 'saved games'}.
        </p>
      )}
    </>
  )

  if (variant === 'strip') {
    // On a phone the field takes the strip's first line for itself.
    return (
      <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-2 sm:flex-1 sm:basis-0">
        <label className="min-w-0 flex-1 basis-[16rem]">
          <span className="sr-only">{label}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAdded(null)
            }}
            className={stripField}
            placeholder={`${label}: title, or title + platform`}
            autoComplete="off"
          />
        </label>
        {(hits.length > 0 || added || (query.trim() && catalog.status === 'ready')) && (
          <div className="basis-full space-y-1">{results}</div>
        )}
      </div>
    )
  }

  return (
    <Window title={label} order={0}>
      <label className="block">
        <span className="eyebrow mb-1.5 block">{label}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setAdded(null)
          }}
          className={field}
          placeholder="Type a title, or title + platform: bully ps2"
          autoComplete="off"
        />
      </label>
      <div className="mt-2 space-y-2">{results}</div>
    </Window>
  )
}
