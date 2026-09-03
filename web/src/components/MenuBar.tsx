import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { MenuBar as Bar, MenuBarClock, type Menu, type MenuEntry } from '@/components/retro-os/menu-bar'
import { AboutDialog } from '@/components/AboutDialog'
import { shortcutLabel } from '@/components/Spotlight'
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/types'

/**
 * The system menu bar. These are real menus rather than scenery: they navigate,
 * switch the theme, open the About window and the search palette.
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
  const [aboutOpen, setAboutOpen] = useState(false)
  const keys = shortcutLabel()

  function restart() {
    try {
      sessionStorage.removeItem('retroheat-booted')
    } catch {
      // Private browsing; the reload alone is enough.
    }
    window.location.reload()
  }

  const apple: MenuEntry[] = [
    { label: 'About This RetroHeat…', onSelect: () => setAboutOpen(true) },
    'separator',
    { label: 'Methodology', onSelect: () => navigate('/about') },
  ]

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Find Game…', shortcut: keys, onSelect: onSearch },
        'separator',
        { label: 'Open Trending', onSelect: () => navigate('/') },
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
              className="flex items-center gap-1.5 px-2 py-0.5 text-[0.7rem] outline-none hover:bg-[var(--foreground)] hover:text-[var(--card)] focus-visible:bg-[var(--foreground)] focus-visible:text-[var(--card)]"
              aria-label={`Search games (${keys})`}
              title={`Search games (${keys})`}
            >
              <Search className="size-3.5" aria-hidden />
              <kbd className="hidden text-[0.65rem] sm:inline">{keys}</kbd>
            </button>
            <MenuBarClock />
          </>
        }
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}
