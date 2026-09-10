import { useState } from 'react'
import { useAccount } from '@/lib/account'
import { parseMoney } from '@/lib/format'
import { MAX_PAID_CENTS } from '@/lib/shelf'

/**
 * What a copy cost, typed straight into its row. Saves on Enter or when the
 * field loses focus; an empty field forgets the price; anything that is not
 * a price, or more than the store allows, snaps back to the stored one.
 * Follows the stored value when it
 * changes from elsewhere, including a rollback after a failed write.
 */
export function PaidField({ gameId, title, value }: { gameId: string; title: string; value: number | null }) {
  const account = useAccount()
  const stored = value === null ? '' : (value / 100).toFixed(2)
  const [text, setText] = useState(stored)
  const [seen, setSeen] = useState(stored)
  if (stored !== seen) {
    setSeen(stored)
    setText(stored)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      if (value !== null) void account.setPaid(gameId, null)
      return
    }
    const cents = parseMoney(trimmed)
    if (cents === null || cents > MAX_PAID_CENTS || cents === value) {
      setText(stored)
      return
    }
    void account.setPaid(gameId, cents)
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-[var(--muted-foreground)]" aria-hidden>
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setText(stored)
          }
        }}
        aria-label={`Paid for ${title}, in dollars`}
        placeholder="—"
        className="bevel-in tabular w-20 border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1 text-right text-xs outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </span>
  )
}
