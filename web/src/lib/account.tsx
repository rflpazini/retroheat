import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Loadable } from '@/lib/data'
import type { AuthUser, CollectionItem, ShelfBackend } from '@/lib/shelf'
import { isAuthEnabled, loadSupabaseBackend } from '@/lib/supabase'
import type { Condition } from '@/lib/types'

export type AccountStatus = 'disabled' | 'loading' | 'signed-out' | 'signed-in'

export interface Account {
  status: AccountStatus
  user: AuthUser | null
  signInOpen: boolean
  openSignIn: () => void
  closeSignIn: () => void
  signInWithGoogle: () => Promise<void>
  signInWithEmail: (email: string) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  saved: Loadable<Set<string>>
  isSaved: (id: string) => boolean
  toggleSaved: (id: string) => Promise<void>
  collection: Loadable<Map<string, CollectionItem>>
  owned: (id: string) => CollectionItem | undefined
  setOwned: (id: string, condition: Condition | null) => Promise<void>
  /** The last failed write, in the backend's words; cleared by the next success. */
  error: string | null
  /** Why the last sign-in redirect failed, e.g. a magic link opened in another browser. */
  signInError: string | null
}

const noop = async () => {}

/**
 * What every hook sees when there is no provider or no backend: accounts off,
 * empty lists, every action a no-op. Pages render exactly as they did before
 * accounts existed.
 */
const disabled: Account = {
  status: 'disabled',
  user: null,
  signInOpen: false,
  openSignIn: () => {},
  closeSignIn: () => {},
  signInWithGoogle: noop,
  signInWithEmail: noop,
  signOut: noop,
  deleteAccount: noop,
  saved: { status: 'ready', data: new Set() },
  isSaved: () => false,
  toggleSaved: noop,
  collection: { status: 'ready', data: new Map() },
  owned: () => undefined,
  setOwned: noop,
  error: null,
  signInError: null,
}

const AccountContext = createContext<Account>(disabled)

/** True below a provider, so a nested one (the shell's own) steps aside. */
const Provided = createContext(false)

export function useAccount(): Account {
  return useContext(AccountContext)
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const RETURN_KEY = 'retroheat-auth-return'
const AUTH_PARAMS = ['code', 'error', 'error_code', 'error_description']

/** Where the provider sends the browser back to: the site root, hash and all. */
function redirectTarget(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function stashReturn(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path)
  } catch {
    // Private browsing; the user lands on the home board instead.
  }
}

function takeReturn(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return v
  } catch {
    return null
  }
}

/**
 * Strips the provider's query parameters once the SDK has read them. The hash
 * belongs to the router and replaceState leaves it alone, so no navigation
 * happens here.
 */
function consumeAuthParams(): { errorDescription: string | null } {
  const url = new URL(window.location.href)
  const errorDescription = url.searchParams.get('error_description')
  if (AUTH_PARAMS.some((k) => url.searchParams.has(k))) {
    for (const k of AUTH_PARAMS) url.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', url)
  }
  return { errorDescription }
}

/**
 * Holds the signed-in user and their lists for everything under it. The
 * backend is loaded once, on demand; pass one explicitly in tests, or null to
 * run with accounts off.
 */
export function AccountProvider(props: {
  backend?: (() => Promise<ShelfBackend>) | null
  children: React.ReactNode
}) {
  // The shell mounts a provider of its own. When a test, or a future host,
  // has already put one above it, the inner one must not shadow it with a
  // fresh, disabled account.
  if (useContext(Provided)) return <>{props.children}</>
  return (
    <Provided.Provider value={true}>
      <AccountState {...props} />
    </Provided.Provider>
  )
}

function AccountState({
  backend,
  children,
}: {
  backend?: (() => Promise<ShelfBackend>) | null
  children: React.ReactNode
}) {
  // Fixed for the provider's life, so an inline loader in a test does not
  // restart the sign-in machinery on every render.
  const [load] = useState(() => (backend === undefined ? (isAuthEnabled() ? loadSupabaseBackend : null) : backend))
  const navigate = useNavigate()
  const location = useLocation()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const locationRef = useRef(location)
  locationRef.current = location

  const ref = useRef<ShelfBackend | null>(null)
  const [status, setStatus] = useState<AccountStatus>(load ? 'loading' : 'disabled')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [saved, setSaved] = useState<Loadable<Set<string>>>({ status: 'ready', data: new Set() })
  const [collection, setCollection] = useState<Loadable<Map<string, CollectionItem>>>({
    status: 'ready',
    data: new Map(),
  })
  const [error, setError] = useState<string | null>(null)
  const [signInError, setSignInError] = useState<string | null>(null)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const collectionRef = useRef(collection)
  collectionRef.current = collection

  useEffect(() => {
    if (!load) return
    let cancelled = false
    let unsubscribe = () => {}
    ;(async () => {
      try {
        const b = await load()
        if (cancelled) return
        ref.current = b
        // getUser waits for the SDK to finish reading any ?code= from the
        // URL, which is why the parameters are only stripped afterwards.
        const u = await b.getUser()
        if (cancelled) return
        const { errorDescription } = consumeAuthParams()
        if (errorDescription) {
          setSignInError(errorDescription)
          setSignInOpen(true)
        }
        setUser(u)
        setStatus(u ? 'signed-in' : 'signed-out')
        unsubscribe = b.onAuthChange((next, event) => {
          setUser(next)
          setStatus(next ? 'signed-in' : 'signed-out')
          if (event === 'signed-in') {
            setSignInOpen(false)
            setSignInError(null)
            consumeAuthParams()
            const back = takeReturn()
            if (back) navigateRef.current(back, { replace: true })
          }
        })
      } catch (e) {
        if (cancelled) return
        setStatus('signed-out')
        setSignInError(messageOf(e))
      }
    })()
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [load])

  // Lists follow the user. They are fetched here, never inside the auth
  // callback, which the SDK documents as a deadlock.
  const userId = user?.id ?? null
  useEffect(() => {
    const b = ref.current
    if (!userId || !b) {
      setSaved({ status: 'ready', data: new Set() })
      setCollection({ status: 'ready', data: new Map() })
      return
    }
    let cancelled = false
    setSaved({ status: 'loading' })
    setCollection({ status: 'loading' })
    Promise.all([b.listSaved(), b.listCollection()])
      .then(([s, c]) => {
        if (cancelled) return
        setSaved({ status: 'ready', data: new Set(s) })
        setCollection({ status: 'ready', data: new Map(c.map((i) => [i.game_id, i])) })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setSaved({ status: 'error', error: messageOf(e) })
        setCollection({ status: 'error', error: messageOf(e) })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const backendOrThrow = () => {
    const b = ref.current
    if (!b) throw new Error('Accounts are not available right now')
    return b
  }

  const signInWithGoogle = useCallback(async () => {
    stashReturn(locationRef.current.pathname)
    await backendOrThrow().signInWithGoogle(redirectTarget())
  }, [])

  const signInWithEmail = useCallback(async (email: string) => {
    stashReturn(locationRef.current.pathname)
    await backendOrThrow().signInWithEmail(email, redirectTarget())
  }, [])

  const signOut = useCallback(async () => {
    await backendOrThrow().signOut()
  }, [])

  const deleteAccount = useCallback(async () => {
    await backendOrThrow().deleteAccount()
  }, [])

  const toggleSaved = useCallback(async (id: string) => {
    const b = backendOrThrow()
    const cur = savedRef.current
    if (cur.status !== 'ready') return
    const was = cur.data.has(id)
    const next = new Set(cur.data)
    if (was) next.delete(id)
    else next.add(id)
    setSaved({ status: 'ready', data: next })
    try {
      if (was) await b.unsave(id)
      else await b.save(id)
      setError(null)
    } catch (e) {
      setSaved(cur)
      setError(messageOf(e))
    }
  }, [])

  const setOwned = useCallback(async (id: string, condition: Condition | null) => {
    const b = backendOrThrow()
    const cur = collectionRef.current
    if (cur.status !== 'ready') return
    const next = new Map(cur.data)
    if (condition) next.set(id, { game_id: id, condition, added_at: new Date().toISOString() })
    else next.delete(id)
    setCollection({ status: 'ready', data: next })
    try {
      if (condition) await b.own(id, condition)
      else await b.disown(id)
      setError(null)
    } catch (e) {
      setCollection(cur)
      setError(messageOf(e))
    }
  }, [])

  const value = useMemo<Account>(
    () => ({
      status,
      user,
      signInOpen,
      openSignIn: () => setSignInOpen(true),
      closeSignIn: () => {
        setSignInOpen(false)
        setSignInError(null)
      },
      signInWithGoogle,
      signInWithEmail,
      signOut,
      deleteAccount,
      saved,
      isSaved: (id) => saved.status === 'ready' && saved.data.has(id),
      toggleSaved,
      collection,
      owned: (id) => (collection.status === 'ready' ? collection.data.get(id) : undefined),
      setOwned,
      error,
      signInError,
    }),
    [status, user, signInOpen, signInWithGoogle, signInWithEmail, signOut, deleteAccount, saved, toggleSaved, collection, setOwned, error, signInError],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
