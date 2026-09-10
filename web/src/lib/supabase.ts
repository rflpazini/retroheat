import { retryOnClockSkew, skewMessage, type ApiError } from '@/lib/retry'
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
    if (error) throw new Error(skewMessage(error))
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
      const { data, error } = await retryOnClockSkew(() =>
        client.from('saved_games').select('game_id').order('created_at', { ascending: false }),
      )
      check(error)
      return ((data ?? []) as { game_id: string }[]).map((r) => r.game_id)
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
      const { data, error } = await retryOnClockSkew(() =>
        client.from('collection_items').select('game_id, condition, added_at').order('added_at', { ascending: false }),
      )
      check(error)
      return (data ?? []) as CollectionItem[]
    },
    async own(gameId, condition: Condition) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('collection_items').upsert({ user_id, game_id: gameId, condition }, { onConflict: 'user_id,game_id' }),
      )
      check(error)
    },
    async disown(gameId) {
      const user_id = await uid()
      const { error } = await retryOnClockSkew(() =>
        client.from('collection_items').delete().eq('user_id', user_id).eq('game_id', gameId),
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
