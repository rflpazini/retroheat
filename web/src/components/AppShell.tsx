import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Disc3, Gamepad2, HardDrive, Info, Menu, Monitor, TrendingUp } from 'lucide-react'
import { MenuBar } from '@/components/MenuBar'
import { BootScreen } from '@/components/BootScreen'
import { Ticker } from '@/components/Ticker'
import { StatusBar } from '@/components/StatusBar'
import { Spotlight, useSpotlightShortcut } from '@/components/Spotlight'
import { AccountSignIn } from '@/components/SignInDialog'
import { AccountProvider } from '@/lib/account'
import { PLATFORMS, PLATFORM_LABELS, type Meta } from '@/lib/types'
import { useJson } from '@/lib/data'
import { relativeDay } from '@/lib/format'
import { cn } from '@/lib/utils'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('retroheat-theme', dark ? 'dark' : 'light')
    } catch {
      // Private browsing; the theme resets on the next visit.
    }
  }, [dark])

  return { dark, toggle: () => setDark((v) => !v) }
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 border-2 px-2.5 py-2 text-xs font-medium transition-none',
    isActive
      ? 'bevel-in border-[var(--border)] bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
      : 'border-transparent text-[var(--sidebar-foreground)] hover:border-[var(--border)] hover:bevel hover:bg-[var(--secondary)]',
  )

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="window-title flex items-center gap-2 px-2 py-1">
        <span className="title-box shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 justify-center">
          <Link
            to="/"
            onClick={onNavigate}
            className="window-title-text pixel flex items-center gap-1.5 text-[0.5rem] uppercase"
          >
            <Disc3 className="size-3 shrink-0" aria-hidden />
            RetroHeat
          </Link>
        </span>
        <span className="title-box shrink-0" aria-hidden />
      </div>
      <div className="stripe" aria-hidden />

      <nav className="flex flex-col gap-1 p-2">
        <p className="eyebrow px-1 pt-1 pb-1">C:\ Overview</p>
        <NavLink to="/" end className={navLink} onClick={onNavigate}>
          <TrendingUp className="size-4 shrink-0" aria-hidden />
          Trending
        </NavLink>

        <p className="eyebrow px-1 pt-3 pb-1">C:\ Platforms</p>
        {PLATFORMS.map((p) => (
          <NavLink key={p} to={`/p/${p}`} className={navLink} onClick={onNavigate}>
            <Gamepad2 className="size-4 shrink-0" aria-hidden />
            {PLATFORM_LABELS[p]}
          </NavLink>
        ))}

        <p className="eyebrow px-1 pt-3 pb-1">C:\ Help</p>
        <NavLink to="/about" className={navLink} onClick={onNavigate}>
          <Info className="size-4 shrink-0" aria-hidden />
          Methodology
        </NavLink>
      </nav>

      <div className="mt-auto border-t-2 border-[var(--border)] p-3">
        <a
          href="https://github.com/rflpazini/retroheat"
          className="flex items-center gap-2 text-[0.7rem] underline"
        >
          <HardDrive className="size-3.5 shrink-0" aria-hidden />
          Source on GitHub
        </a>
      </div>
    </div>
  )
}

function DataSourceNotice() {
  const meta = useJson<Meta>('meta.json')
  if (meta.status === 'loading') return null
  if (meta.status === 'ready' && meta.data.source !== 'fake') return null

  // Fails closed: if the file naming the source cannot be read, say so rather
  // than presenting invented prices as real ones.
  const unverified = meta.status === 'error'
  return (
    <div className="window bevel mb-4 flex items-start gap-3 p-3">
      <span className="pixel shrink-0 text-[0.6rem] text-[var(--primary)]">!</span>
      <p className="text-xs">
        <strong className="pixel mr-1 text-[0.5rem] uppercase">
          {unverified ? 'Unverified source' : 'Sample data'}
        </strong>
        {unverified
          ? 'These prices could not be traced to a data source. Reload before relying on them.'
          : 'Generated for development, not collected from any marketplace. Run the collector with eBay credentials for real figures.'}
      </p>
    </div>
  )
}

const titles: Record<string, string> = {
  '/': 'Trending',
  '/about': 'Methodology',
}

/**
 * The layout route. The account provider sits inside the router so it can
 * send a signed-in visitor back to the page they left, and wraps everything
 * so the menu bar, the sidebar and the pages all see the same user.
 */
export function AppShell() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  )
}

function Shell() {
  const { dark, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const toggleSearch = useCallback(() => setSearchOpen((v) => !v), [])
  useSpotlightShortcut(toggleSearch)
  const location = useLocation()
  const meta = useJson<Meta>('meta.json')

  const title =
    titles[location.pathname] ??
    (location.pathname.startsWith('/p/')
      ? (PLATFORM_LABELS[location.pathname.slice(3) as keyof typeof PLATFORM_LABELS] ?? 'Board')
      : 'Game')

  return (
    <>
      <BootScreen />
      <MenuBar dark={dark} onToggleTheme={toggle} onSearch={() => setSearchOpen(true)} />
      <div className="min-h-screen p-3 sm:p-5 lg:grid lg:grid-cols-[15rem_1fr] lg:gap-5">
      <aside className="window hidden self-start lg:block">
        <SidebarContent />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <div className="window absolute inset-y-2 left-2 w-60 overflow-y-auto">
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <header className="window animate-window">
          <div className="window-title flex items-center gap-2 px-2 py-1">
            <button
              className="press bevel flex size-5 items-center justify-center border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-3" aria-hidden />
            </button>
            <span className="title-box hidden shrink-0 lg:block" aria-hidden />
            <span className="flex min-w-0 flex-1 justify-center">
              <h1 className="window-title-text pixel flex items-center gap-1.5 truncate text-[0.5rem] uppercase">
                <Monitor className="size-3 shrink-0" aria-hidden />
                {title}
              </h1>
            </span>
            <span className="title-box shrink-0" aria-hidden />
          </div>
          <div className="stripe" aria-hidden />

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="eyebrow">
              C:\RETROHEAT\{title.toUpperCase().replace(/ /g, '_')}
            </p>
            {meta.status === 'ready' && (
              <p className="eyebrow">
                {meta.data.counts.tracked} games · updated {relativeDay(meta.data.generated_at)}
              </p>
            )}
          </div>
        </header>

        <Ticker />

        <main className="min-w-0">
          <DataSourceNotice />
          <Outlet />
        </main>

      </div>
      </div>
      <StatusBar />
      <Spotlight open={searchOpen} onOpenChange={setSearchOpen} />
      <AccountSignIn />
    </>
  )
}
