import { useMemo } from 'react'
import { useJson } from '@/lib/data'
import { PLATFORMS, type LatestFile, type LatestGame } from '@/lib/types'

/**
 * Every platform's latest board in one map by game id, so a search result or
 * a shelf line can show its price. Six small files, cached after the first
 * load and shared with the boards.
 */
export function useLatestIndex(enabled: boolean): { index: Map<string, LatestGame>; loading: boolean } {
  // Fixed-length list of hooks: PLATFORMS is a constant.
  const boards = PLATFORMS.map((p) => useJson<LatestFile>(enabled ? `latest/${p}.json` : null))
  const index = useMemo(() => {
    const m = new Map<string, LatestGame>()
    for (const b of boards) {
      if (b.status !== 'ready') continue
      for (const g of b.data.games) m.set(g.id, g)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, boards)
  return { index, loading: enabled && boards.some((b) => b.status === 'loading') }
}
