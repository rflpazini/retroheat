import { Bookmark, BookmarkCheck, Library } from 'lucide-react'
import { useAccount } from '@/lib/account'
import { CONDITIONS, CONDITION_LABELS, type Condition } from '@/lib/types'
import { Message } from '@/components/States'
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

/** The hand-rolled select the boards use, for changing a copy's condition in a row. */
export function ConditionSelect({
  value,
  label,
  placeholder,
  onChange,
}: {
  value: Condition | ''
  label: string
  placeholder?: string
  onChange: (c: Condition) => void
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => e.target.value && onChange(e.target.value as Condition)}
      className="bevel-in border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {CONDITIONS.map((c) => (
        <option key={c} value={c}>
          {CONDITION_LABELS[c]}
        </option>
      ))}
    </select>
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
      return <>{children}</>
  }
}

const iconButton =
  'press bevel inline-flex size-7 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)] aria-pressed:bevel-in aria-pressed:bg-[var(--accent)] aria-pressed:text-[var(--accent-foreground)]'

/**
 * The compact form for a board row: a bookmark toggle and an "own as" picker,
 * so a collection can be filled by scanning a board instead of opening every
 * game. Signed out, the bookmark opens the sign-in window.
 */
export function ShelfRowControls({ gameId, title }: { gameId: string; title: string }) {
  const account = useAccount()
  if (account.status === 'disabled' || account.status === 'loading') return null
  if (account.status === 'signed-out') {
    return (
      <button
        type="button"
        className={iconButton}
        onClick={account.openSignIn}
        aria-label={`Sign in to save ${title}`}
        title="Sign in to save"
      >
        <Bookmark className="size-3.5" aria-hidden />
      </button>
    )
  }
  const saved = account.isSaved(gameId)
  const owned = account.owned(gameId)
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className={iconButton}
        aria-pressed={saved}
        aria-label={saved ? `Saved ${title}` : `Save ${title}`}
        title={saved ? 'Saved' : 'Save'}
        onClick={() => void account.toggleSaved(gameId)}
      >
        {saved ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
      </button>
      <ConditionSelect
        value={owned?.condition ?? ''}
        label={`Own ${title} as`}
        placeholder="Own as…"
        onChange={(c) => void account.setOwned(gameId, c)}
      />
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
