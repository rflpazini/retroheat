import { UserRound } from 'lucide-react'
import { Entries, menuBarClasses } from '@/components/retro-os/menu-bar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAccount } from '@/lib/account'

/** The menu bar's plain buttons: the search button and the sign-in button share it. */
export const menuBarButton =
  'flex items-center gap-1.5 px-2 py-0.5 text-[0.7rem] outline-none hover:bg-[var(--foreground)] hover:text-[var(--card)] focus-visible:bg-[var(--foreground)] focus-visible:text-[var(--card)]'

/**
 * The account corner of the menu bar. Nothing while accounts are off or still
 * loading, a Sign in button when signed out, and the user's avatar with a menu
 * when signed in.
 */
export function UserMenu() {
  const account = useAccount()

  if (account.status === 'disabled' || account.status === 'loading') return null

  if (account.status === 'signed-out' || !account.user) {
    return (
      <button type="button" onClick={account.openSignIn} className={menuBarButton} aria-label="Sign in">
        <UserRound className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    )
  }

  const { user } = account
  const initial = (user.name ?? user.email ?? '?').trim().charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={menuBarClasses.trigger} aria-label="Account menu">
        <span className="bevel inline-flex size-4 items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--secondary)]">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="pixel text-[0.4rem]">{initial}</span>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menuBarClasses.content}>
        <p className="max-w-[16rem] truncate px-2 py-1 text-[0.65rem] opacity-70">{user.email ?? user.name}</p>
        <Entries entries={['separator', { label: 'Sign out', onSelect: () => void account.signOut() }]} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
