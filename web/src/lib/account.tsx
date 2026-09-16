import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Loadable } from '@/lib/data'
import { onShelf, type AuthUser, type CollectionItem, type CopyPatch, type ShelfBackend } from '@/lib/shelf'
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
  /** Every copy, sold ones included, keyed by copy id (by game id on a store from before migration 0004). */
  collection: Loadable<Map<string, CollectionItem>>
  /** False when the store has no copy ids yet: the shelf reads, but nothing on it can be written. */
  copiesSupported: boolean
  /** The copies of a game still on the shelf, oldest first. */
  copiesOf: (gameId: string) => CollectionItem[]
  /** The first copy of a game still on the shelf, for controls that speak of "the" copy. */
  owned: (gameId: string) => CollectionItem | undefined
  /** Sets the first copy's condition, adds a copy when there is none, or with null takes every copy off the shelf. */
  setOwned: (gameId: string, condition: Condition | null) => Promise<void>
  addCopy: (gameId: string, condition: Condition) => Promise<void>
  updateCopy: (copyId: string, patch: CopyPatch) => Promise<void>
  removeCopy: (copyId: string) => Promise<void>
  /** Records what a copy cost, or forgets it with null. */
  setPaid: (copyId: string, cents: number | null) => Promise<void>
  /** The copy just added to the shelf, for the window that asks what it cost; null when none. */
  pendingAdd: { copy_id: string; game_id: string; condition: Condition } | null
  dismissAdd: () => void
  /** The copy whose Info window is open, and whether it opened to record a sale. */
  infoCopy: { id: string; sell: boolean } | null
  openInfo: (copyId: string, opts?: { sell?: boolean }) => void
  closeInfo: () => void
  /** The last failed write, in the backend's words; cleared by the next success. */
  error: string | null
  /** Why the last sign-in redirect failed, e.g. a magic link opened in another browser. */
  signInError: string | null
}

/** What a write is refused with on a store that predates copies. */
export const COPIES_MIGRATION =
  'The database has not been updated for copies yet (apply supabase/migrations/0004_copies.sql)'

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
  copiesSupported: true,
  copiesOf: () => [],
  owned: () => undefined,
  setOwned: noop,
  addCopy: noop,
  updateCopy: noop,
  removeCopy: noop,
  setPaid: noop,
  pendingAdd: null,
  dismissAdd: () => {},
  infoCopy: null,
  openInfo: () => {},
  closeInfo: () => {},
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

type Shelf = Loadable<Map<string, CollectionItem>>

/** The map key of a copy: its id, or the game on a store that has none yet. */
const keyOf = (item: CollectionItem) => item.id ?? item.game_id

/** Whether every row carries a copy id; an empty shelf can be written to. */
function supported(shelf: Shelf): boolean {
  return shelf.status === 'ready' && [...shelf.data.values()].every((i) => i.id !== undefined)
}

/** The copies of a game still on the shelf, oldest first. */
function copiesIn(shelf: Map<string, CollectionItem>, gameId: string): CollectionItem[] {
  return [...shelf.values()]
    .filter((i) => i.game_id === gameId && onShelf(i))
    .sort((a, b) => a.added_at.localeCompare(b.added_at))
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
  const [collection, setCollection] = useState<Shelf>({ status: 'ready', data: new Map() })
  const [error, setError] = useState<string | null>(null)
  const [pendingAdd, setPendingAdd] = useState<Account['pendingAdd']>(null)
  const [infoCopy, setInfoCopy] = useState<Account['infoCopy']>(null)
  // A failed write's message belongs to the page it happened on; leaving the
  // page gives the status strip back to the price caveat. The same goes for
  // the windows about one copy.
  useEffect(() => {
    setError(null)
    setPendingAdd(null)
    setInfoCopy(null)
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
        setCollection({ status: 'ready', data: new Map(c.map((i) => [keyOf(i), i])) })
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

  // A shelf write needs the backend and a store with copy ids; either
  // missing is said once on the status strip and nothing moves.
  const ready = useCallback(async (): Promise<{ b: ShelfBackend; shelf: Map<string, CollectionItem> } | null> => {
    let b: ShelfBackend
    try {
      b = await ensure()
    } catch (e) {
      setError(messageOf(e))
      return null
    }
    const cur = collectionRef.current
    if (cur.status !== 'ready') return null
    if (!supported(cur)) {
      setError(COPIES_MIGRATION)
      return null
    }
    return { b, shelf: cur.data }
  }, [ensure])

  // Change one copy in place, whatever the shelf looks like by the time the
  // write comes back; a row put back after a failure keeps the rest as is.
  const patchShelf = useCallback((fn: (next: Map<string, CollectionItem>) => void) => {
    setCollection((c) => {
      if (c.status !== 'ready') return c
      const next = new Map(c.data)
      fn(next)
      return { status: 'ready', data: next }
    })
  }, [])

  // Copies whose insert is in flight carry a key of their own until the store
  // names them; nothing else may address them in the meantime.
  const tempSeq = useRef(0)
  const inFlight = useRef(new Set<string>())

  const addCopy = useCallback(
    async (gameId: string, condition: Condition) => {
      const r = await ready()
      if (!r) return
      const temp = `pending-${++tempSeq.current}`
      inFlight.current.add(temp)
      patchShelf((next) =>
        next.set(temp, { id: temp, game_id: gameId, condition, added_at: new Date().toISOString(), paid_cents: null }),
      )
      const from = locationRef.current.pathname
      try {
        const row = await r.b.addCopy({ game_id: gameId, condition })
        patchShelf((next) => {
          next.delete(temp)
          next.set(keyOf(row), row)
        })
        setError(null)
        // The copy gets the window asking what it cost once the write has
        // landed, and only if the visitor is still on the same page.
        if (row.id && locationRef.current.pathname === from) setPendingAdd({ copy_id: row.id, game_id: gameId, condition })
      } catch (e) {
        patchShelf((next) => next.delete(temp))
        setError(messageOf(e))
      } finally {
        inFlight.current.delete(temp)
      }
    },
    [ready, patchShelf],
  )

  // The latest edit of a copy wins: a slower earlier write must not put its
  // value, or its failure, over a later one.
  const copySeq = useRef(new Map<string, number>())
  const updateCopy = useCallback(
    async (copyId: string, patch: CopyPatch) => {
      const seq = (copySeq.current.get(copyId) ?? 0) + 1
      copySeq.current.set(copyId, seq)
      const r = await ready()
      if (!r || inFlight.current.has(copyId)) return
      const before = r.shelf.get(copyId)
      if (!before) return
      patchShelf((next) => next.set(copyId, { ...before, ...patch }))
      try {
        await r.b.updateCopy(copyId, patch)
        if (copySeq.current.get(copyId) !== seq) return
        setError(null)
      } catch (e) {
        if (copySeq.current.get(copyId) !== seq) return
        // Put back this one copy, not the whole shelf as it was.
        patchShelf((next) => next.set(copyId, before))
        setError(messageOf(e))
      }
    },
    [ready, patchShelf],
  )

  const removeCopy = useCallback(
    async (copyId: string) => {
      const r = await ready()
      if (!r || inFlight.current.has(copyId)) return
      const before = r.shelf.get(copyId)
      if (!before) return
      patchShelf((next) => next.delete(copyId))
      try {
        await r.b.removeCopy(copyId)
        setError(null)
      } catch (e) {
        patchShelf((next) => next.set(copyId, before))
        setError(messageOf(e))
      }
    },
    [ready, patchShelf],
  )

  const setOwned = useCallback(
    async (gameId: string, condition: Condition | null) => {
      const cur = collectionRef.current
      if (cur.status !== 'ready') return
      const copies = copiesIn(cur.data, gameId)
      if (condition) {
        const first = copies[0]
        if (!first) return addCopy(gameId, condition)
        if (!first.id) {
          setError(COPIES_MIGRATION)
          return
        }
        return updateCopy(first.id, { condition })
      }
      if (copies.length === 0) return
      if (!supported(cur)) {
        setError(COPIES_MIGRATION)
        return
      }
      await Promise.all(copies.map((c) => removeCopy(c.id!)))
    },
    [addCopy, updateCopy, removeCopy],
  )

  const setPaid = useCallback((copyId: string, cents: number | null) => updateCopy(copyId, { paid_cents: cents }), [updateCopy])

  // Stable, so the windows' mount effects do not re-run on every provider render.
  const dismissAdd = useCallback(() => setPendingAdd(null), [])
  const openInfo = useCallback((id: string, opts?: { sell?: boolean }) => setInfoCopy({ id, sell: opts?.sell ?? false }), [])
  const closeInfo = useCallback(() => setInfoCopy(null), [])

  const value = useMemo<Account>(() => {
    const copiesOf = (gameId: string) => (collection.status === 'ready' ? copiesIn(collection.data, gameId) : [])
    return {
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
      copiesSupported: supported(collection),
      copiesOf,
      owned: (gameId) => copiesOf(gameId)[0],
      setOwned,
      addCopy,
      updateCopy,
      removeCopy,
      setPaid,
      pendingAdd,
      dismissAdd,
      infoCopy,
      openInfo,
      closeInfo,
      error,
      signInError,
    }
  }, [
    status,
    user,
    signInOpen,
    ensure,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    deleteAccount,
    saved,
    toggleSaved,
    collection,
    setOwned,
    addCopy,
    updateCopy,
    removeCopy,
    setPaid,
    pendingAdd,
    dismissAdd,
    infoCopy,
    openInfo,
    closeInfo,
    error,
    signInError,
  ])

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
