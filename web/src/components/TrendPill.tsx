import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { heat, pct, trendLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  value: number | null
  className?: string
  showIcon?: boolean
}

/**
 * The direction badge. Its colour comes from the heat ramp, so size and
 * direction of a move read before the number does.
 */
export function TrendPill({ value, className, showIcon = true }: Props) {
  const color = heat(value)
  const label = trendLabel(value)
  const Icon = label === 'Rising' ? ArrowUpRight : label === 'Cooling' ? ArrowDownRight : Minus

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        className,
      )}
      style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {pct(value)}
    </span>
  )
}

export function TrendStatus({ value }: { value: number | null }) {
  const color = heat(value)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {trendLabel(value)}
    </span>
  )
}
