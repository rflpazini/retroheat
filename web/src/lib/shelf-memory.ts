import type { AuthEvent, AuthUser, CollectionItem, ShelfBackend } from '@/lib/shelf'
import type { Condition } from '@/lib/types'

export interface MemoryState {
  user: AuthUser | null
  saved: Set<string>
  collection: Map<string, CollectionItem>
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

/**
 * An in-memory backend for tests and local demos. Every call resolves on the
 * next tick, which is enough to exercise loading states without a network.
 */
export function memoryBackend(seed: {
  user?: AuthUser | null
  saved?: string[]
  collection?: CollectionItem[]
} = {}): { backend: ShelfBackend; state: MemoryState } {
  const listeners = new Set<(user: AuthUser | null, event: AuthEvent) => void>()
  const emit = (event: AuthEvent) => {
    for (const cb of listeners) cb(state.user, event)
  }
  const state: MemoryState = {
    user: seed.user ?? null,
    saved: new Set(seed.saved ?? []),
    collection: new Map((seed.collection ?? []).map((c) => [c.game_id, c])),
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
      return [...state.saved]
    },
    async save(id) {
      requireUser()
      state.saved.add(id)
    },
    async unsave(id) {
      requireUser()
      state.saved.delete(id)
    },
    async listCollection() {
      requireUser()
      return [...state.collection.values()]
    },
    async own(id, condition: Condition) {
      requireUser()
      state.collection.set(id, { game_id: id, condition, added_at: '2026-09-07T00:00:00Z' })
    },
    async disown(id) {
      requireUser()
      state.collection.delete(id)
    },
    async deleteAccount() {
      requireUser()
      state.deleted = true
      state.saved.clear()
      state.collection.clear()
      state.user = null
      emit('signed-out')
    },
  }
  return { backend, state }
}
