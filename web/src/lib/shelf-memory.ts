import type { AuthEvent, AuthUser, CollectionItem, CopyPatch, NewCopy, Profile, SavedGame, ShelfBackend } from '@/lib/shelf'
import { onShelf } from '@/lib/shelf'

export interface MemoryState {
  user: AuthUser | null
  /** The sharing choices, null until made. */
  profile: Profile | null
  /** Saved games by game id. */
  saved: Map<string, SavedGame>
  /** Every copy, sold ones included, by its own id. */
  collection: Map<string, CollectionItem>
  /** The copies of a game still on the shelf, in the order they were added. */
  copiesOf(gameId: string): CollectionItem[]
  /** The first such copy, for tests that speak of "the" copy of a game. */
  copyOf(gameId: string): CollectionItem | undefined
  /** The address the last magic link was requested for. */
  sentTo: string | null
  /** The redirect the last Google sign-in asked for. */
  googleRedirect: string | null
  deleted: boolean
  /** Simulates the browser coming back from the provider signed in. */
  completeSignIn(user: AuthUser): void
}

export const testUser: AuthUser = {
  id: 'user-1',
  email: 'collector@example.com',
  name: 'Collector',
  avatarUrl: null,
}

const SEED_DAY = '2026-09-07T00:00:00Z'

/**
 * An in-memory backend for tests and local demos. Every call resolves on the
 * next tick, which is enough to exercise loading states without a network.
 */
export function memoryBackend(
  seed: {
    user?: AuthUser | null
    /** Game ids, or full rows when a target matters. */
    saved?: (string | SavedGame)[]
    collection?: CollectionItem[]
    /** Answer like a store from before migration 0004: rows without an id. */
    legacy?: boolean
    profile?: Profile | null
    /** Shelf names other people already hold. */
    takenSlugs?: string[]
  } = {},
): { backend: ShelfBackend; state: MemoryState } {
  const listeners = new Set<(user: AuthUser | null, event: AuthEvent) => void>()
  const emit = (event: AuthEvent) => {
    for (const cb of listeners) cb(state.user, event)
  }
  let copies = 0
  const nextId = () => `copy-${++copies}`
  const seeded = (seed.collection ?? []).map((c) => ({ ...c, id: c.id ?? nextId(), paid_cents: c.paid_cents ?? null }))
  const savedRows = (seed.saved ?? []).map((s): SavedGame =>
    typeof s === 'string' ? { game_id: s, created_at: SEED_DAY, target_cents: null } : { ...s, target_cents: s.target_cents ?? null },
  )
  const state: MemoryState = {
    user: seed.user ?? null,
    profile: seed.profile ?? null,
    saved: new Map(savedRows.map((s) => [s.game_id, s])),
    collection: new Map(seeded.map((c) => [c.id, c])),
    copiesOf(gameId) {
      return [...state.collection.values()].filter((c) => c.game_id === gameId && onShelf(c))
    },
    copyOf(gameId) {
      return state.copiesOf(gameId)[0]
    },
    sentTo: null,
    googleRedirect: null,
    deleted: false,
    completeSignIn(user) {
      state.user = user
      emit('signed-in')
    },
  }
  const requireUser = () => {
    if (!state.user) throw new Error('Sign in first')
  }

  const backend: ShelfBackend = {
    getUser: async () => state.user,
    onAuthChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signInWithGoogle(redirectTo) {
      state.googleRedirect = redirectTo
    },
    async signInWithEmail(email) {
      // A well-formed address the backend still refuses, so tests can see
      // how a server-side failure is shown.
      if (email.endsWith('@example.invalid')) throw new Error('Email rate limit exceeded')
      state.sentTo = email
    },
    async signOut() {
      state.user = null
      emit('signed-out')
    },
    async listSaved() {
      requireUser()
      return [...state.saved.values()]
    },
    async save(id) {
      requireUser()
      if (!state.saved.has(id)) state.saved.set(id, { game_id: id, created_at: SEED_DAY, target_cents: null })
    },
    async unsave(id) {
      requireUser()
      state.saved.delete(id)
    },
    async setTarget(id, cents) {
      requireUser()
      const before = state.saved.get(id)
      if (!before) throw new Error('Not saved')
      state.saved.set(id, { ...before, target_cents: cents })
    },
    async listCollection() {
      requireUser()
      const rows = [...state.collection.values()]
      if (!seed.legacy) return rows
      return rows.map((r) => {
        const row = { ...r }
        delete row.id
        return row
      })
    },
    async addCopy(copy: NewCopy) {
      requireUser()
      const item: CollectionItem = {
        id: nextId(),
        game_id: copy.game_id,
        condition: copy.condition,
        added_at: SEED_DAY,
        paid_cents: copy.paid_cents ?? null,
        acquired_on: copy.acquired_on ?? null,
        notes: copy.notes ?? null,
        sold_cents: null,
        sold_on: null,
      }
      state.collection.set(item.id!, item)
      return item
    },
    async addCopies(copies: NewCopy[]) {
      const out: CollectionItem[] = []
      for (const c of copies) out.push(await backend.addCopy(c))
      return out
    },
    async updateCopy(id, patch: CopyPatch) {
      requireUser()
      const before = state.collection.get(id)
      if (!before) throw new Error('No such copy')
      state.collection.set(id, { ...before, ...patch })
    },
    async removeCopy(id) {
      requireUser()
      state.collection.delete(id)
    },
    async getProfile() {
      requireUser()
      return state.profile
    },
    async saveProfile(p) {
      requireUser()
      if ((seed.takenSlugs ?? []).includes(p.slug)) throw new Error('That name is taken.')
      state.profile = { ...p }
    },
    async deleteAccount() {
      requireUser()
      state.deleted = true
      state.saved.clear()
      state.collection.clear()
      state.profile = null
      state.user = null
      emit('signed-out')
    },
  }
  return { backend, state }
}
