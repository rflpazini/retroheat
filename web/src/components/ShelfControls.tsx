import { useRef } from 'react'
import { Bookmark, BookmarkCheck, ChevronDown, Library } from 'lucide-react'
import { useAccount, type Account } from '@/lib/account'
import { conditionColor } from '@/lib/format'
import { CONDITIONS, CONDITION_LABELS, type Condition } from '@/lib/types'
import { cn } from '@/lib/utils'
import { menuBarClasses } from '@/components/retro-os/menu-bar'
import { Message } from '@/components/States'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Window } from '@/components/Window'

export const shelfButton =
  'press bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5'

const toggle = (active: boolean) =>
  `press border-2 border-[var(--border)] px-3 py-1.5 text-xs font-semibold ${
    active ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bevel bg-[var(--secondary)]'
  }`

/** Save / Saved, on a game page. Signed out, it opens the sign-in window. */
export function SaveButton({ gameId }: { gameId: string }) {
  const account = useAccount()
  if (account.status === 'disabled' || account.status === 'loading') return null
  if (account.status === 'signed-out') {
    return (
      <button type="button" className={shelfButton} onClick={account.openSignIn}>
        <Bookmark className="size-3.5" aria-hidden />
        Save
      </button>
    )
  }
  const saved = account.isSaved(gameId)
  return (
    <button type="button" className={shelfButton} aria-pressed={saved} onClick={() => void account.toggleSaved(gameId)}>
      {saved ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
      {saved ? 'Saved' : 'Save'}
    </button>
  )
}

/**
 * "I own this", with the condition of the copy, reusing the chart's condition
 * toggle so the two vocabularies are visibly the same thing.
 */
export function OwnControl({ gameId }: { gameId: string }) {
  const account = useAccount()
  if (account.status === 'disabled' || account.status === 'loading') return null
  if (account.status === 'signed-out') {
    return (
      <div className="mt-4">
        <button type="button" className={shelfButton} onClick={account.openSignIn}>
          <Library className="size-3.5" aria-hidden />
          I own this
        </button>
      </div>
    )
  }
  const owned = account.owned(gameId)
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="eyebrow">{owned ? 'In my collection as' : 'I own this'}</span>
      <div className="flex" role="group" aria-label="Condition owned">
        {CONDITIONS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={owned?.condition === c}
            className={toggle(owned?.condition === c)}
            onClick={() => void account.setOwned(gameId, c)}
          >
            {CONDITION_LABELS[c]}
          </button>
        ))}
      </div>
      {owned && (
        <button type="button" className="text-xs underline" onClick={() => void account.setOwned(gameId, null)}>
          Remove
        </button>
      )}
      {account.error && (
        <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
          {account.error}
        </p>
      )}
    </div>
  )
}

/**
 * Wraps a shelf page: explains itself when accounts are off, asks to sign in
 * when signed out, and only renders the page for a signed-in visitor.
 */
export function ShelfGate({ what, children }: { what: string; children: React.ReactNode }) {
  const account = useAccount()
  switch (account.status) {
    case 'disabled':
      return (
        <Message
          title="Accounts are not enabled"
          detail="This copy of RetroHeat runs without Supabase, so there is nothing to sign in to. The boards work as usual."
        />
      )
    case 'loading':
      return (
        <Window title="Loading…">
          <p className="pixel text-[0.6rem]">Reading disk…</p>
        </Window>
      )
    case 'signed-out':
      return (
        <Message
          title={`Sign in to see your ${what}`}
          detail="Saved games and your collection live with your account, so they follow you across devices."
          action={
            <button type="button" className={shelfButton} onClick={account.openSignIn}>
              Sign in
            </button>
          }
        />
      )
    default:
      // A focusable region, so a control that removes its own row can hand
      // focus back to the page instead of letting it fall to <body>.
      return (
        <section aria-label={`Your ${what}`} tabIndex={-1} data-shelf-anchor>
          {children}
        </section>
      )
  }
}

/*
  The row control is a two-key toolbar, the way a palette in a paint program
  put related tools side by side: a bookmark key and an "own as" key that
  opens a menu. Every key is the same height, the pair has one width on every
  row, and it always sits in the row's shelf column, so the eye can run down a
  board and read which games are saved and which are owned without hunting.
*/
const key =
  'press inline-flex h-7 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold outline-none'
const keyDown = 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]'
const keyUp = 'bevel'
const bookmarkKey = 'w-7'
/* Wide enough for "Complete" with its swatch and arrow; fixed so the pair never jitters. */
const ownKey = '-ml-0.5 w-[7.75rem] justify-between gap-1.5 px-2 data-[popup-open]:bevel-in'

/*
  Run an action that may unmount the control that has focus (removing a row
  from the saved list or the shelf). If the control survives, nothing moves;
  if it is gone, focus goes to the next row, else the previous, else the
  page's region. A menu's own "return focus to the trigger" is a no-op on a
  detached element, which is why this has to be explicit.
*/
async function keepingFocus(control: HTMLElement | null, action: () => Promise<void>) {
  const row = control?.closest<HTMLElement>('tr, [data-shelf-row]') ?? null
  const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null
  const anchor = control?.closest<HTMLElement>('[data-shelf-anchor]') ?? null
  await action()
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!control || control.isConnected) return
  const target = neighbour?.isConnected ? neighbour.querySelector<HTMLElement>('a, button') : null
  ;(target ?? anchor)?.focus()
}

function Swatch({ condition }: { condition: Condition }) {
  return (
    <span
      className="size-2 shrink-0 border border-[var(--border)]"
      style={{ background: conditionColor(condition) }}
      aria-hidden
    />
  )
}

interface KeyProps {
  account: Account
  gameId: string
  title: string
}

/** The bookmark key: pressed while the game is saved. */
function BookmarkKey({ account, gameId, title }: KeyProps) {
  if (account.status === 'signed-out') {
    return (
      <button
        type="button"
        className={cn(key, keyUp, bookmarkKey)}
        onClick={account.openSignIn}
        aria-label={`Sign in to save ${title}`}
        title="Sign in to save"
      >
        <Bookmark className="size-3.5" aria-hidden />
      </button>
    )
  }
  const saved = account.isSaved(gameId)
  return (
    <button
      type="button"
      className={cn(key, saved ? keyDown : keyUp, bookmarkKey)}
      aria-pressed={saved}
      aria-label={`Save ${title}`}
      title={saved ? 'Saved · press again to remove' : 'Save'}
      onClick={(e) => void keepingFocus(e.currentTarget, () => account.toggleSaved(gameId))}
    >
      {saved ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
    </button>
  )
}

/**
 * The own-as key. Unowned it reads "Own"; owned it is pressed and reads the
 * condition of the copy with its colour, so the board doubles as a checklist.
 * The menu is a real menu in the system's chrome, with a checkmark against
 * the current condition and, once owned, a way out.
 */
function OwnKey({ account, gameId, title }: KeyProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  if (account.status === 'signed-out') {
    return (
      <button
        type="button"
        className={cn(key, keyUp, ownKey)}
        onClick={account.openSignIn}
        aria-label={`Sign in to add ${title} to your collection`}
        title="Sign in to mark the games you own"
      >
        Own
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
    )
  }
  const owned = account.owned(gameId)?.condition
  const label = owned ? CONDITION_LABELS[owned] : 'Own'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        className={cn(key, owned ? keyDown : keyUp, ownKey)}
        aria-label={owned ? `Own ${title} as: ${label}` : `Own ${title} as`}
        title={owned ? `In your collection as ${label.toLowerCase()}` : 'Mark as owned'}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {owned && <Swatch condition={owned} />}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menuBarClasses.content}>
        <DropdownMenuRadioGroup
          value={owned ?? ''}
          onValueChange={(value) => void account.setOwned(gameId, value as Condition)}
        >
          {CONDITIONS.map((c) => (
            <DropdownMenuRadioItem key={c} value={c} className={cn(menuBarClasses.item, 'gap-2 pr-7')}>
              <Swatch condition={c} />
              {CONDITION_LABELS[c]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {owned && (
          <>
            <DropdownMenuSeparator className="bg-[var(--border)]" />
            <DropdownMenuItem
              className={menuBarClasses.item}
              onClick={() => void keepingFocus(trigger.current, () => account.setOwned(gameId, null))}
            >
              Remove from collection
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The shelf controls for one row of a board or list. Signed out, the same two
 * keys appear and both open the sign-in window, so the shelf is visible before
 * it is usable and the row keeps its shape when the visitor signs in.
 */
export function ShelfRowControls({ gameId, title, className }: { gameId: string; title: string; className?: string }) {
  const account = useAccount()
  if (account.status === 'disabled' || account.status === 'loading') return null
  return (
    <span className={cn('inline-flex items-center', className)}>
      <BookmarkKey account={account} gameId={gameId} title={title} />
      <OwnKey account={account} gameId={gameId} title={title} />
    </span>
  )
}

/** The nudge on a game page for a visitor who is not signed in. Nothing is blocked. */
export function ShelfInvite() {
  const account = useAccount()
  if (account.status !== 'signed-out') return null
  return (
    <Window title="Your shelf" order={1}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="pixel text-[0.6rem]">Building a collection?</p>
          <p className="mt-2 max-w-md text-xs">
            Sign in to save games and mark the ones you own. Your shelf adds up what your copies are asking
            today and shows which ones moved this week.
          </p>
        </div>
        <button type="button" className={shelfButton} onClick={account.openSignIn}>
          <Library className="size-3.5" aria-hidden />
          Sign in and start saving
        </button>
      </div>
    </Window>
  )
}
