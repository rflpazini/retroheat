import type { Meta } from './types'

/**
 * How many games the boards on disk hold. A collector run limited to some
 * platforms reports only what it priced in counts.tracked, while
 * counts.per_platform describes every board on disk, touched or not. Files
 * written before that field existed fall back to the run's count.
 */
export function gamesOnDisk(meta: Meta): number {
  const per = meta.counts.per_platform
  if (!per) return meta.counts.tracked
  return Object.values(per).reduce<number>((sum, n) => sum + (n ?? 0), 0)
}
