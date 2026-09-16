import { explainError, retryOnClockSkew, type ApiError } from '@/lib/retry'
import type { AuthEvent, AuthUser, CollectionItem, ShelfBackend } from '@/lib/shelf'
import type { Condition } from '@/lib/types'

export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  return url && anonKey ? { url, anonKey } : null
}

/** A function rather than a constant so tests can flip the environment. */
export function isAuthEnabled(): boolean {
  return supabaseEnv() !== null
}

/**
 * The only module that touches the Supabase SDK, and it loads it on demand:
 * the account provider calls this when a stored session may exist, when the
 * browser returns from the provider, or on the first click on Sign in. An
 * anonymous visitor reading prices never downloads the chunk, and a build
 * without the environment never even references it.
 */
export async function loadSupabaseBackend(): Promise<ShelfBackend> {
  const env = supabaseEnv()
  if (!env) throw new Error('Supabase is not configured')
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(env.url, env.anonKey, {
    auth: {
      // PKCE puts the code in the query string, ahead of the hash the router
      // owns; the implicit flow would put tokens in the fragment and collide.
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'retroheat-auth',
    },
  })

  type RawUser = { id: string; email?: string; user_metadata?: Record<string, unknown> }
  const toUser = (u: RawUser | null | undefined): AuthUser | null => {
    if (!u) return null
    const meta = u.user_metadata ?? {}
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
    return {
      id: u.id,
      email: u.email ?? null,
      name: str(meta.full_name) ?? str(meta.name),
      avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
    }
  }

  const uid = async (): Promise<string> => {
    const { data } = await client.auth.getSession()
    const id = data.session?.user.id
    if (!id) throw new Error('Sign in first')
    return id
  }

  const check = (error: ApiError | null) => {
    if (error) throw new Error(explainError(error))
  }

  // Row mirrors collection_items by hand: keep it in step with
  // supabase/migrations. A key missing from the row altogether means the
  // column does not exist yet: without paid_cents the page hides the field
  // (0003); without id the shelf reads but refuses to write (0004).
  type Row = {
    id?: string
    game_id: string
    condition: Condition
    added_at: string
    paid_cents?: number | null
    acquired_on?: string | null
    notes?: string | null
    sold_cents?: number | null
    sold_on?: string | null
  }
  const toItem = (r: Row): CollectionItem => {
    const copies = 'id' in r
    return {
      id: copies ? r.id : undefined,
      game_id: r.game_id,
      condition: r.condition,
      added_at: r.added_at,
      paid_cents: 'paid_cents' in r ? (r.paid_cents ?? null) : undefined,
      acquired_on: copies ? (r.acquired_on ?? null) : undefined,
      notes: copies ? (r.notes ?? null) : undefined,
      sold_cents: copies ? (r.sold_cents ?? null) : undefined,
      sold_on: copies ? (r.sold_on ?? null) : undefined,
    }
  }

  return {
    async getUser() {
      const { data } = await client.auth.getSession()
      return toUser(data.session?.user)
    },
    onAuthChange(cb) {
      const events: Record<string, AuthEvent> = {
        INITIAL_SESSION: 'initial',
        SIGNED_IN: 'signed-in',
        SIGNED_OUT: 'signed-out',
      }
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Nothing else from the SDK is awaited in here: supabase-js warns that
        // doing so deadlocks. The provider fetches lists in an effect instead.
        cb(toUser(session?.user), events[event] ?? 'refresh')
      })
      return () => data.subscription.unsubscribe()
    },
    async signInWithGoogle(redirectTo) {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
      check(error)
    },
    async signInWithEmail(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      })
      check(error)
    },
    async signOut() {
      const { error } = await client.auth.signOut()
      check(error)
    },
    // Every database call goes through retryOnClockSkew: a token minted a
    // moment ago can be refused as "issued at future" and pass seconds later.
    async listSaved() {
      // Every column, for the same reason as the collection: a row without
      // the target_cents key means migration 0004 is not applied yet.
      const { data, error } = await retryOnClockSkew(() =>
        client.from('saved_games').select('*').order('created_at', { ascending: false }),
      )
      check(error)
      type SavedRow = { game_id: string; created_at: string; target_cents?: number | null }
      return ((data ?? []) as SavedRow[]).map((r) => ({
        game_id: r.game_id,
        created_at: r.created_at,
        target_cents: 'target_cents' in r ? (r.target_cents ?? null) : undefined,
      }))
    },
    async setTarget(gameId, cents) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('saved_games').update({ target_cents: cents }).eq('user_id', user_id).eq('game_id', gameId),
      )
      check(error)
    },
    async save(gameId) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client
          .from('saved_games')
          .upsert({ user_id, game_id: gameId }, { onConflict: 'user_id,game_id', ignoreDuplicates: true }),
      )
      check(error)
    },
    async unsave(gameId) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('saved_games').delete().eq('user_id', user_id).eq('game_id', gameId),
      )
      check(error)
    },
    async listCollection() {
      // Every column, so a site deployed ahead of a migration still loads the
      // shelf; toItem reads what is there.
      const { data, error } = await retryOnClockSkew(() =>
        client.from('collection_items').select('*').order('added_at', { ascending: false }),
      )
      check(error)
      return ((data ?? []) as Row[]).map(toItem)
    },
    async addCopy(copy) {
      const user_id = await uid()
      // The store names the copy, so the row comes back rather than a count.
      const { data, error } = await retryOnClockSkew(() =>
        client.from('collection_items').insert({ user_id, ...copy }).select().single(),
      )
      check(error)
      return toItem(data as Row)
    },
    async updateCopy(id, patch) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('collection_items').update(patch).eq('id', id).eq('user_id', user_id),
      )
      check(error)
    },
    async removeCopy(id) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('collection_items').delete().eq('id', id).eq('user_id', user_id),
      )
      check(error)
    },
    async deleteAccount() {
      const { error } = await retryOnClockSkew(() => client.rpc('delete_my_account'))
      check(error)
      await client.auth.signOut()
    },
  }
}
