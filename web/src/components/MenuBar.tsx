import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AboutDialog } from '@/components/AboutDialog'
import { shortcutLabel } from '@/components/Spotlight'
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/types'

function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="tabular">
      {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
    </span>
  )
}

const trigger =
  'px-2 py-0.5 text-[0.7rem] outline-none data-[state=open]:bg-[var(--border)] data-[state=open]:text-[var(--card)]'

const menuContent =
  'window min-w-[12rem] rounded-none border-2 p-1 font-[family-name:var(--font-sans)]'

const menuItem = 'rounded-none px-2 py-1 text-[0.75rem] focus:bg-[var(--border)] focus:text-[var(--card)]'

/**
 * The system menu bar. These are real menus rather than scenery: they navigate,
 * switch the theme and open the About window, which is what makes the page read
 * as an operating system instead of an app wearing its chrome.
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
  const keys = shortcutLabel()
  const [aboutOpen, setAboutOpen] = useState(false)

  function restart() {
    try {
      sessionStorage.removeItem('retroheat-booted')
    } catch {
      // Private browsing; the reload alone is enough.
    }
    window.location.reload()
  }

  return (
    <>
      <div
        className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b-2 border-[var(--border)] px-1 py-0.5"
        style={{ background: 'var(--menubar)' }}
      >
        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger className={trigger} aria-label="Apple menu">
              &#63743;
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={menuContent}>
              <DropdownMenuItem className={menuItem} onClick={() => setAboutOpen(true)}>
                About This RetroHeat…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuItem} onClick={() => navigate('/about')}>
                Methodology
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="pixel px-2 text-[0.5rem] uppercase">RetroHeat</span>

          <DropdownMenu>
            <DropdownMenuTrigger className={trigger}>File</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={menuContent}>
              <DropdownMenuItem className={menuItem} onClick={onSearch}>
                Find Game…
                <DropdownMenuShortcut className="pl-6 text-[0.65rem] tracking-normal">{keys}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuItem} onClick={() => navigate('/')}>
                Open Trending
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {PLATFORMS.map((p) => (
                <DropdownMenuItem
                  key={p}
                  className={menuItem}
                  onClick={() => navigate(`/p/${p}`)}
                >
                  Open {PLATFORM_LABELS[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={trigger}>View</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={menuContent}>
              <DropdownMenuItem className={menuItem} onClick={onToggleTheme}>
                {dark ? 'Daylight monitor' : 'Night monitor'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={trigger}>Special</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={menuContent}>
              <DropdownMenuItem className={menuItem} onClick={restart}>
                Restart
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={menuItem}
                onClick={() => window.open('https://github.com/rflpazini/retroheat', '_blank')}
              >
                Source on GitHub
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSearch}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[0.7rem] outline-none hover:bg-[var(--border)] hover:text-[var(--card)] focus-visible:bg-[var(--border)] focus-visible:text-[var(--card)]"
            aria-label={`Search games (${keys})`}
            title={`Search games (${keys})`}
          >
            <Search className="size-3.5" aria-hidden />
            <kbd className="hidden text-[0.65rem] sm:inline">{keys}</kbd>
          </button>
          <span className="px-2 text-[0.7rem]">
            <Clock />
          </span>
        </div>
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}
