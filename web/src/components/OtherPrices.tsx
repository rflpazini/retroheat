import { companions, money } from '@/lib/format'
import { CONDITION_LABELS, type Condition, type PriceMap } from '@/lib/types'

/**
 * The conditions a headline price leaves out, as "Loose $45.00 · Sealed $2,748".
 * Wherever one number stands for a game, this sits beside it so the reader
 * can tell a complete-copy price from the loose market they may have seen.
 */
export function OtherPrices({
  prices,
  headline,
  className = '',
}: {
  prices: PriceMap | undefined
  headline: Condition
  className?: string
}) {
  const others = companions(prices, headline)
  if (others.length === 0) return null
  return (
    <p className={`eyebrow tabular ${className}`}>
      {others.map((o) => `${CONDITION_LABELS[o.condition]} ${money(o.cents)}`).join(' · ')}
    </p>
  )
}
