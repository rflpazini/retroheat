import { useState } from 'react'
import { parseMoney } from '@/lib/format'
import { MAX_PAID_CENTS } from '@/lib/shelf'

/**
 * A dollar amount typed straight into a row. Saves on Enter or when the
 * field loses focus; an empty field forgets the amount; anything that is not
 * a price, or more than the store allows, snaps back to the stored one.
 * Follows the stored value when it changes from elsewhere, including a
 * rollback after a failed write.
 */
export function MoneyField({
  label,
  value,
  onCommit,
  max = MAX_PAID_CENTS,
}: {
  /** The accessible name, e.g. "Paid for Bully, in dollars". */
  label: string
  value: number | null
  onCommit: (cents: number | null) => void
  max?: number
}) {
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
      if (value !== null) onCommit(null)
      return
    }
    const cents = parseMoney(trimmed)
    if (cents === null || cents > max || cents === value) {
      setText(stored)
      return
    }
    onCommit(cents)
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
        aria-label={label}
        placeholder="—"
        className="bevel-in tabular w-20 border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1 text-right text-xs outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </span>
  )
}
