import { useEffect, useRef, useState } from 'react'
import { useAccount } from '@/lib/account'
import { takeReturnFocus } from '@/lib/focus'
import { useJson } from '@/lib/data'
import { conditionColor, moneyExact, parseMoney, pct, signedMoney } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { MAX_PAID_CENTS } from '@/lib/shelf'
import { CONDITION_LABELS, PLATFORM_SHORT, type Condition, type GameDetail } from '@/lib/types'

const field = 'bevel-in tabular w-32 border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-right text-xs outline-none'
/* A classic Mac push button: a rounded rectangle that inverts while pressed. */
const macButton =
  'min-w-[4.5rem] rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-1 text-xs font-semibold active:bg-[var(--border)] active:text-[var(--card)]'

/**
 * The window that opens the moment a copy joins the shelf: the game, the
 * condition chosen, what it asks today, and one question, what did you pay.
 * Skipping is fine; the copy is already on the shelf either way. Built like
 * the sign-in window rather than on the dialog primitive, because it opens
 * from a menu and a menu's focus restore fights a primitive's focus trap.
 */
export function AddToShelfDialog({
  gameId,
  condition,
  onClose,
}: {
  gameId: string
  condition: Condition
  onClose: () => void
}) {
  const account = useAccount()
  const detail = useJson<GameDetail>(`games/${gameId}.json`)
  const { index } = usePriceIndex()
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<Element | null>(null)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    // The key that opened the menu noted itself; otherwise the focused control.
    restoreRef.current = takeReturnFocus() ?? document.activeElement
    // After the frame, so the field keeps focus over any late hand-back by
    // the menu that triggered the add.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      if (restoreRef.current instanceof HTMLElement && restoreRef.current.isConnected) restoreRef.current.focus()
    }
  }, [onClose])

  const game = detail.status === 'ready' ? detail.data : null
  const title = game?.title ?? gameId
  const asking = index.get(gameId)?.prices[condition] ?? null
  const typed = text.trim() ? parseMoney(text) : null
  const preview = typed !== null && typed <= MAX_PAID_CENTS && asking !== null ? asking - typed : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseMoney(text)
    if (cents === null) {
      setProblem('Type a price like 12.50, or skip.')
      return
    }
    if (cents > MAX_PAID_CENTS) {
      setProblem(`That is more than the shelf can record (${moneyExact(MAX_PAID_CENTS)}).`)
      return
    }
    onClose()
    await account.setPaid(gameId, cents)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-24">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

      {/*
        A System 7 movable modal: pinstriped title with no boxes, an icon on
        the left, the message beside it, and the buttons bottom-right with the
        default one wearing the thick rounded ring that answered Return.
      */}
      <div role="dialog" aria-modal="true" aria-labelledby="add-title" className="window animate-window relative w-full max-w-lg">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span id="add-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
            On the shelf
          </span>
        </div>

        <form onSubmit={save} className="flex gap-5 p-5">
          {/* The diskette from the disk window, so the copy reads as media going onto a shelf. */}
          <span className="bevel mt-1 flex size-12 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)]" aria-hidden>
            <span className="flex size-full flex-col items-center justify-between p-1">
              <span className="h-3 w-5 border border-[var(--border)] bg-[var(--card)]" />
              <span className="h-3 w-8 border border-[var(--border)] bg-[var(--muted)]" />
            </span>
          </span>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="pixel text-[0.6rem] leading-relaxed">{title}</p>
              <p className="eyebrow mt-1 flex items-center gap-1.5">
                {game && <span>{PLATFORM_SHORT[game.platform]} ·</span>}
                <span className="size-2 border border-[var(--border)]" style={{ background: conditionColor(condition) }} aria-hidden />
                <span>{CONDITION_LABELS[condition]} copy is on your shelf</span>
              </p>
            </div>

            <div className="bevel-in flex items-baseline justify-between gap-4 border-2 border-[var(--border)] px-3 py-2">
              <span className="eyebrow">Asking today</span>
              <span className="tabular text-lg font-bold">
                {asking === null ? (
                  <span className="text-sm font-semibold text-[var(--muted-foreground)]">no price at this condition</span>
                ) : (
                  moneyExact(asking)
                )}
              </span>
            </div>

            <label className="block">
              <span className="eyebrow mb-1.5 block">What did you pay?</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--muted-foreground)]" aria-hidden>
                  $
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setProblem(null)
                  }}
                  aria-label={`Paid for ${title}, in dollars`}
                  aria-describedby="add-preview"
                  placeholder="0.00"
                  className={field}
                />
                <span id="add-preview" className="text-xs">
                  {preview !== null && typed !== null ? (
                    <>
                      <span className="tabular font-semibold">{signedMoney(preview)}</span>
                      {typed > 0 && <span className="eyebrow ml-1.5">{pct((preview / typed) * 100)} vs paid</span>}
                    </>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">same dollars as the boards</span>
                  )}
                </span>
              </span>
            </label>

            {problem && (
              <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
                {problem}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" className={macButton} onClick={onClose}>
                Skip
              </button>
              {/* The default button: Return presses it, and the ring says so. */}
              <span className="rounded-[10px] border-[3px] border-[var(--border)] p-[2px]">
                <button type="submit" className={macButton}>
                  Save
                </button>
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Mounts the window whenever the provider has a copy just added. */
export function AccountAddToShelf() {
  const account = useAccount()
  if (!account.pendingAdd) return null
  return (
    <AddToShelfDialog
      key={`${account.pendingAdd.game_id}-${account.pendingAdd.condition}`}
      gameId={account.pendingAdd.game_id}
      condition={account.pendingAdd.condition}
      onClose={account.dismissAdd}
    />
  )
}
