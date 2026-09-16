import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { MenuBar as Bar, MenuBarClock, type Menu, type MenuEntry } from '@/components/retro-os/menu-bar'
import { AboutDialog } from '@/components/AboutDialog'
import { ImportDialog } from '@/components/ImportDialog'
import { shortcutLabel } from '@/components/Spotlight'
import { UserMenu, menuBarButton } from '@/components/UserMenu'
import { useAccount } from '@/lib/account'
import { loadJson } from '@/lib/data'
import { collectionCSV, download, exportName, savedCSV } from '@/lib/export'
import { PLATFORMS, PLATFORM_LABELS, type CatalogFile, type PriceIndexFile } from '@/lib/types'

/**
 * The system menu bar. These are real menus rather than scenery: they navigate,
 * switch the theme, open the About window and the search palette, and for a
 * signed-in visitor move the shelf in and out as files.
 */
export function MenuBar({
  dark,
  onToggleTheme,
  onSearch,
}: {
  dark: boolean
  onToggleTheme: () => void
  onSearch: () => void
}) {
  const navigate = useNavigate()
  const account = useAccount()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const keys = shortcutLabel()

  function restart() {
    try {
      sessionStorage.removeItem('retroheat-booted')
    } catch {
      // Private browsing; the reload alone is enough.
    }
    window.location.reload()
  }

  // The catalog and the price index are fetched only when an export is
  // picked; a menu that is never used should cost nothing.
  async function exportList(kind: 'collection' | 'saved') {
    const [catalog, prices] = await Promise.all([loadJson<CatalogFile>('catalog.json'), loadJson<PriceIndexFile>('prices.json')])
    const byId = new Map(catalog.games.map((g) => [g.id, g]))
    const index = new Map(Object.entries(prices.games))
    const text =
      kind === 'collection'
        ? collectionCSV(account.collection.status === 'ready' ? [...account.collection.data.values()] : [], byId, index)
        : savedCSV(account.saved.status === 'ready' ? [...account.saved.data.values()] : [], byId, index)
    download(exportName(kind), text)
  }

  const apple: MenuEntry[] = [
    { label: 'About This RetroHeat…', onSelect: () => setAboutOpen(true) },
    'separator',
    { label: 'Methodology', onSelect: () => navigate('/about') },
  ]

  const shelfItems: MenuEntry[] =
    account.status !== 'disabled'
      ? [
          { label: 'Open Saved Games', onSelect: () => navigate('/saved') },
          { label: 'Open My Collection', onSelect: () => navigate('/collection') },
        ]
      : []
  const fileItems: MenuEntry[] =
    account.status === 'signed-in'
      ? [
          'separator',
          { label: 'Export Collection…', onSelect: () => void exportList('collection').catch(console.error) },
          { label: 'Export Saved Games…', onSelect: () => void exportList('saved').catch(console.error) },
          { label: 'Import Collection…', onSelect: () => setImportOpen(true) },
        ]
      : []

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Find Game…', shortcut: keys, onSelect: onSearch },
        'separator',
        { label: 'Open Trending', onSelect: () => navigate('/') },
        ...shelfItems,
        ...fileItems,
        'separator',
        ...PLATFORMS.map((p) => ({ label: `Open ${PLATFORM_LABELS[p]}`, onSelect: () => navigate(`/p/${p}`) })),
      ],
    },
    {
      label: 'View',
      items: [{ label: dark ? 'Daylight monitor' : 'Night monitor', onSelect: onToggleTheme }],
    },
    {
      label: 'Special',
      items: [
        { label: 'Restart', onSelect: restart },
        'separator',
        {
          label: 'Source on GitHub',
          onSelect: () => window.open('https://github.com/rflpazini/retroheat', '_blank'),
        },
      ],
    },
  ]

  return (
    <>
      <Bar
        name="RetroHeat"
        apple={apple}
        menus={menus}
        right={
          <>
            <button
              type="button"
              onClick={onSearch}
              className={menuBarButton}
              aria-label={`Search games (${keys})`}
              title={`Search games (${keys})`}
            >
              <Search className="size-3.5" aria-hidden />
              <kbd className="hidden text-[0.65rem] sm:inline">{keys}</kbd>
            </button>
            <UserMenu />
            <MenuBarClock />
          </>
        }
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )
}
