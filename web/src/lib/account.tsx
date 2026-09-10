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
const SESSION_KEY = 'retroheat-auth'
const AUTH_PARAMS = ['code', 'error', 'error_code', 'error_description']

/**
 * Whether the SDK must load on arrival: only when a session may exist or the
 * provider just sent the browser back. An anonymous visitor reading prices
 * never downloads it; the first click on Sign in does.
 */
function needsBackendNow(): boolean {
  try {
    if (localStorage.getItem(SESSION_KEY)) return true
  } catch {
    // Private browsing; no stored session to resume.
  }
  const params = new URL(window.location.href).searchParams
  return AUTH_PARAMS.some((k) => params.has(k))
}

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
  /** Load the backend on mount rather than on the first sign-in; defaults to when a session may exist. */
  eager?: boolean
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
  eager,
  children,
}: {
  backend?: (() => Promise<ShelfBackend>) | null
  eager?: boolean
  children: React.ReactNode
}) {
  // Fixed for the provider's life, so an inline loader in a test does not
  // restart the sign-in machinery on every render.
  const [load] = useState(() => (backend === undefined ? (isAuthEnabled() ? loadSupabaseBackend : null) : backend))
  // A backend handed in explicitly (tests) is wanted at once; the real one
  // only when a visitor may be signed in or is returning from the provider.
  const [loadNow] = useState(() => eager ?? (backend !== undefined || needsBackendNow()))
  const navigate = useNavigate()
  const location = useLocation()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const locationRef = useRef(location)
  locationRef.current = location

  const ref = useRef<ShelfBackend | null>(null)
  const pending = useRef<Promise<ShelfBackend> | null>(null)
  const cancelled = useRef(false)
  const unsubscribe = useRef<() => void>(() => {})
  const [status, setStatus] = useState<AccountStatus>(!load ? 'disabled' : loadNow ? 'loading' : 'signed-out')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [saved, setSaved] = useState<Loadable<Set<string>>>({ status: 'ready', data: new Set() })
  const [collection, setCollection] = useState<Loadable<Map<string, CollectionItem>>>({
    status: 'ready',
    data: new Map(),
  })
  const [error, setError] = useState<string | null>(null)
  // A failed write's message belongs to the page it happened on; leaving the
  // page gives the status strip back to the price caveat.
  useEffect(() => {
    setError(null)
  }, [location.pathname])
  const [signInError, setSignInError] = useState<string | null>(null)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const collectionRef = useRef(collection)
  collectionRef.current = collection

  // ensure loads the backend once and wires it up; every action goes through
  // it, so the SDK arrives on the first click when it did not arrive on load.
  const ensure = useCallback((): Promise<ShelfBackend> => {
    if (!load) return Promise.reject(new Error('Accounts are not available right now'))
    if (!pending.current) {
      pending.current = (async () => {
        const b = await load()
        ref.current = b
        // getUser waits for the SDK to finish reading any ?code= from the
        // URL, which is why the parameters are only stripped afterwards.
        const u = await b.getUser()
        if (cancelled.current) return b
        const { errorDescription } = consumeAuthParams()
        if (errorDescription) {
          setSignInError(errorDescription)
          setSignInOpen(true)
        }
        setUser(u)
        setStatus(u ? 'signed-in' : 'signed-out')
        unsubscribe.current = b.onAuthChange((next, event) => {
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
        return b
      })().catch((e: unknown) => {
        pending.current = null
        if (!cancelled.current) {
          setStatus('signed-out')
          setSignInError(messageOf(e))
        }
        throw e
      })
    }
    return pending.current
  }, [load])

  useEffect(() => {
    cancelled.current = false
    if (load && loadNow) void ensure().catch(() => {})
    return () => {
      cancelled.current = true
      unsubscribe.current()
    }
  }, [load, loadNow, ensure])

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

  const signInWithGoogle = useCallback(async () => {
    stashReturn(locationRef.current.pathname)
    const b = await ensure()
    await b.signInWithGoogle(redirectTarget())
  }, [ensure])

  const signInWithEmail = useCallback(
    async (email: string) => {
      stashReturn(locationRef.current.pathname)
      const b = await ensure()
      await b.signInWithEmail(email, redirectTarget())
    },
    [ensure],
  )

  const signOut = useCallback(async () => {
    const b = await ensure()
    await b.signOut()
  }, [ensure])

  const deleteAccount = useCallback(async () => {
    const b = await ensure()
    await b.deleteAccount()
  }, [ensure])

  const toggleSaved = useCallback(async (id: string) => {
    const b = await ensure()
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
    const b = await ensure()
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
      openSignIn: () => {
        // The first click is when an anonymous visitor's SDK download starts.
        void ensure().catch(() => {})
        setSignInOpen(true)
      },
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
    [status, user, signInOpen, ensure, signInWithGoogle, signInWithEmail, signOut, deleteAccount, saved, toggleSaved, collection, setOwned, error, signInError],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
