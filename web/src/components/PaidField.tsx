import { useAccount } from '@/lib/account'
import { MoneyField } from '@/components/MoneyField'

/** What a copy cost, typed straight into its row on the collection page. */
export function PaidField({ copyId, title, value }: { copyId: string; title: string; value: number | null }) {
  const account = useAccount()
  return <MoneyField label={`Paid for ${title}, in dollars`} value={value} onCommit={(cents) => void account.setPaid(copyId, cents)} />
}
