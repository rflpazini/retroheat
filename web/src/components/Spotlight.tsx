import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, Info, TrendingUp } from 'lucide-react'
import {
  Spotlight as Palette,
  shortcutLabel,
  useSpotlightShortcut,
  type SpotlightItem,
} from '@/components/retro-os/spotlight'
import { useJson } from '@/lib/data'
import { headlinePrice, money, priceMap } from '@/lib/format'
import { rank, rankBoards, BOARDS } from '@/lib/search'
import {
  CONDITION_LABELS,
  PLATFORMS,
  PLATFORM_SHORT,
  type CatalogFile,
  type CatalogGame,
  type LatestFile,
  type LatestGame,
} from '@/lib/types'
import { OtherPrices } from '@/components/OtherPrices'

export { shortcutLabel, useSpotlightShortcut }

const LIMIT = 10

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

function boardIcon(to: string) {
  const Icon = to === '/' ? TrendingUp : to === '/about' ? Info : Gamepad2
  return <Icon className="size-4" />
}

function gameItem(game: CatalogGame, price: LatestGame | undefined): SpotlightItem {
  const headline = price ? headlinePrice(price.prices) : null
  return {
    id: game.id,
    title: game.title,
    group: 'Games',
    image: game.info?.cover_url,
    icon: <span className="pixel text-[0.4rem]">{PLATFORM_SHORT[game.platform]}</span>,
    subtitle: [PLATFORM_SHORT[game.platform], game.info?.year, game.info?.developer].filter(Boolean).join(' · '),
    trailing: headline ? (
      <>
        <span className="tabular block text-sm font-semibold">{money(headline.cents)}</span>
        <span className="eyebrow block">{CONDITION_LABELS[headline.condition]}</span>
        {price && <OtherPrices prices={priceMap(price.prices)} headline={headline.condition} />}
      </>
    ) : (
      <span className="eyebrow block">{price ? 'unpriced' : ''}</span>
    ),
    data: { kind: 'game', platform: game.platform },
  }
}

/**
 * The shelf's search palette: every catalogued game plus the boards, ranked
 * by the catalog-aware rules in lib/search ("bully ps2" filters by platform).
 * The chrome and keyboard handling are the registry's spotlight item.
 */
export function Spotlight({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const catalog = useJson<CatalogFile>(open ? 'catalog.json' : null)
  const prices = useLatestIndex(open)

  const games = catalog.status === 'ready' ? catalog.data.games : []
  const total = games.length

  const items = useMemo<SpotlightItem[]>(() => {
    const boards: SpotlightItem[] = BOARDS.map((b) => ({
      id: `board:${b.to}`,
      title: b.label,
      group: 'Go to',
      icon: boardIcon(b.to),
      pinned: true,
      keywords: b.keywords,
      data: { kind: 'board' },
    }))
    return [...games.map((g) => gameItem(g, prices.get(g.id))), ...boards]
  }, [games, prices])

  // Games first by the catalog ranking, then whichever boards the words name.
  const search = useCallback(
    (query: string, all: SpotlightItem[]) => {
      if (!query) return all.filter((i) => i.pinned)
      const byId = new Map(all.map((i) => [i.id, i]))
      const hits = rank(query, games, LIMIT).map((h) => byId.get(h.item.id)!)
      const boards = rankBoards(query).map((b) => byId.get(`board:${b.to}`)!)
      return [...hits, ...boards]
    },
    [games],
  )

  return (
    <Palette
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      search={search}
      onSelect={(item) => navigate(item.id.startsWith('board:') ? item.id.slice('board:'.length) : `/g/${item.id}`)}
      label="Search the shelf"
      inputLabel="Search games"
      placeholder="Search a game title…"
      loading={catalog.status === 'loading'}
      notice={catalog.status === 'error' ? 'The catalog could not be loaded. Reload and try again.' : undefined}
      hint="Type a title, or title + platform"
      status={(shown) => `${shown.filter((i) => i.data?.kind === 'game').length} of ${total} titles`}
      empty={(q) => (
        <>
          No game called <strong>“{q}”</strong> on the shelf. {total} titles are tracked; add a platform to
          narrow, for example <em>bully ps2</em>.
        </>
      )}
    />
  )
}
