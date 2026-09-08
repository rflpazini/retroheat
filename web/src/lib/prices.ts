import { useMemo } from 'react'
import { useJson } from '@/lib/data'
import type { PriceEntry, PriceIndexFile } from '@/lib/types'

/**
 * Every priced game's latest medians in one small file, so a search result or
 * a shelf line can show its price without downloading the six boards.
 */
export function usePriceIndex(enabled = true): { index: Map<string, PriceEntry>; loading: boolean } {
  const file = useJson<PriceIndexFile>(enabled ? 'prices.json' : null)
  const index = useMemo(() => {
    const m = new Map<string, PriceEntry>()
    if (file.status === 'ready') {
      for (const [id, entry] of Object.entries(file.data.games)) m.set(id, entry)
    }
    return m
  }, [file])
  return { index, loading: enabled && file.status === 'loading' }
}
