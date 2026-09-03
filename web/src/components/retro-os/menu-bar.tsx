import { Fragment, useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: React.ReactNode
  onSelect?: () => void
  /** Shown right-aligned, e.g. "⌘K". Display only; bind the key yourself. */
  shortcut?: string
  disabled?: boolean
}

export type MenuEntry = MenuItem | 'separator'

export interface Menu {
  label: React.ReactNode
  items: MenuEntry[]
  /** Accessible name for the trigger when the label is not text. */
  ariaLabel?: string
}

interface MenuBarProps {
  /** The application name, set in the pixel face after the apple menu. */
  name: React.ReactNode
  menus: Menu[]
  /** Items under the apple; omit for no apple menu. */
  apple?: MenuEntry[]
  /** Right-hand side: a clock, a search button, status glyphs. */
  right?: React.ReactNode
  className?: string
}

const trigger =
  'px-2 py-0.5 text-[0.7rem] outline-none data-[state=open]:bg-[var(--border)] data-[state=open]:text-[var(--card)] data-[popup-open]:bg-[var(--border)] data-[popup-open]:text-[var(--card)]'

const content = 'window min-w-[12rem] rounded-none border-2 p-1 font-[family-name:var(--font-sans)]'

const item =
  'rounded-none px-2 py-1 text-[0.75rem] focus:bg-[var(--foreground)] focus:text-[var(--card)] data-[highlighted]:bg-[var(--foreground)] data-[highlighted]:text-[var(--card)]'

function Entries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) =>
        e === 'separator' ? (
          <DropdownMenuSeparator key={i} />
        ) : (
          <DropdownMenuItem key={i} className={item} onClick={e.onSelect} disabled={e.disabled}>
            {e.label}
            {e.shortcut && (
              <DropdownMenuShortcut className="pl-6 text-[0.65rem] tracking-normal">{e.shortcut}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}

/**
 * The system menu bar, pinned to the top of the viewport. The menus are real:
 * each item runs its onSelect, which is what makes a page read as an
 * operating system instead of an app wearing its chrome.
 */
export function MenuBar({ name, menus, apple, right, className }: MenuBarProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 flex items-center justify-between gap-2 border-b-2 border-[var(--border)] px-1 py-0.5',
        className,
      )}
      style={{ background: 'var(--menubar)' }}
    >
      <div className="flex items-center">
        {apple && (
          <DropdownMenu>
            <DropdownMenuTrigger className={trigger} aria-label="Apple menu">
              &#63743;
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={content}>
              <Entries entries={apple} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span className="pixel px-2 text-[0.5rem] uppercase">{name}</span>

        {menus.map((menu, i) => (
          <Fragment key={i}>
            <DropdownMenu>
              <DropdownMenuTrigger className={trigger} aria-label={menu.ariaLabel}>
                {menu.label}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={content}>
                <Entries entries={menu.items} />
              </DropdownMenuContent>
            </DropdownMenu>
          </Fragment>
        ))}
      </div>

      {right !== undefined && <div className="flex items-center gap-1">{right}</div>}
    </div>
  )
}

/** A live clock in the menu bar's corner, in the locale's short time format. */
export function MenuBarClock({ locale = 'en-US' }: { locale?: string }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="tabular px-2 text-[0.7rem]">
      {now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}
