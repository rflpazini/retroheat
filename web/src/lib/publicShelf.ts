import { SLUG_RE } from '@/lib/shelf'
import { supabaseEnv } from '@/lib/supabase'
import type { Condition } from '@/lib/types'

/*
  Someone else's shelf, read by link. The two public views answer the anon
  key with plain fetch, so a visitor who follows a link never downloads the
  Supabase SDK. The database decides what leaves: slug, game, condition, the
  day it was added, and the paid price only when its owner shares it.
*/

export interface PublicItem {
  game_id: string
  condition: Condition
  added_at: string
  paid_cents: number | null
}

export type PublicShelfResult = { kind: 'shelf'; slug: string; items: PublicItem[] } | { kind: 'missing' }

/** The shelf behind a name: its items, or missing when no public shelf has that name. */
export async function fetchPublicShelf(slug: string): Promise<PublicShelfResult> {
  const env = supabaseEnv()
  if (!env || !SLUG_RE.test(slug)) return { kind: 'missing' }
  const headers = { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` }
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${env.url}/rest/v1/${path}`, { headers })
    if (!res.ok) throw new Error(`the shelf could not be read (${res.status})`)
    return res.json() as Promise<T>
  }
  const name = encodeURIComponent(slug)
  // Two reads, so an empty shelf and a name nobody shares read differently.
  const profiles = await get<{ slug: string }[]>(`public_profiles?select=slug&slug=eq.${name}`)
  if (!Array.isArray(profiles) || profiles.length === 0) return { kind: 'missing' }
  const items = await get<PublicItem[]>(`shelves?select=game_id,condition,added_at,paid_cents&slug=eq.${name}&order=added_at.asc`)
  return { kind: 'shelf', slug, items }
}

/** The address a shared shelf lives at: the site's base and the hash route. */
export function shareLink(slug: string, origin: string = window.location.origin, base: string = import.meta.env.BASE_URL): string {
  return `${origin}${base}#/u/${slug}`
}
