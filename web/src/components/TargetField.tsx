import { useAccount } from '@/lib/account'
import { MoneyField } from '@/components/MoneyField'

/** The most its owner would pay for a saved game, typed straight into its row. */
export function TargetField({ gameId, title, value }: { gameId: string; title: string; value: number | null }) {
  const account = useAccount()
  return (
    <MoneyField label={`Target for ${title}, in dollars`} value={value} onCommit={(cents) => void account.setTarget(gameId, cents)} />
  )
}
