import { useEffect, useRef, useState } from 'react'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { parseDay, today } from '@/lib/day'
import { takeReturnFocus } from '@/lib/focus'
import { conditionColor, moneyExact, parseMoney } from '@/lib/format'
import { MAX_NOTES, MAX_PAID_CENTS, type CopyPatch } from '@/lib/shelf'
import { CONDITIONS, CONDITION_LABELS, PLATFORM_SHORT, type Condition, type GameDetail } from '@/lib/types'
import { defaultRing, macButton, macField } from '@/components/mac'
import { MacCheckbox } from '@/components/MacCheckbox'

const toggle = (active: boolean) =>
  `press border-2 border-[var(--border)] px-3 py-1 text-xs font-semibold ${
    active ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bevel bg-[var(--secondary)]'
  }`

const money = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2))

/**
 * Get Info on one copy: everything the shelf knows about it in one window,
 * the way the Finder put a file's facts behind ⌘I. Condition, what it cost
 * and when, a note, and whether it has been sold, for how much and on what
 * day. One write on Save, nothing on Cancel. Built like the paid window: it
 * opens from a row's menu, and a menu's focus restore fights a dialog
 * primitive's focus trap.
 */
export function CopyInfoDialog({ copyId, sell, onClose }: { copyId: string; sell: boolean; onClose: () => void }) {
  const account = useAccount()
  const copy = account.collection.status === 'ready' ? account.collection.data.get(copyId) : undefined
  const detail = useJson<GameDetail>(copy ? `games/${copy.game_id}.json` : null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  const [condition, setCondition] = useState<Condition>(copy?.condition ?? 'cib')
  const [paid, setPaid] = useState(money(copy?.paid_cents))
  const [acquired, setAcquired] = useState(copy?.acquired_on ?? '')
  const [notes, setNotes] = useState(copy?.notes ?? '')
  const [sold, setSold] = useState(sell || copy?.sold_on != null)
  const [soldFor, setSoldFor] = useState(money(copy?.sold_cents))
  const [soldOn, setSoldOn] = useState(copy?.sold_on ?? (sell ? today() : ''))
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    restoreRef.current = takeReturnFocus() ?? document.activeElement
    const frame = requestAnimationFrame(() => firstRef.current?.focus())
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

  if (!copy) return null
  const game = detail.status === 'ready' ? detail.data : null
  const title = game?.title ?? copy.game_id

  function readMoney(text: string, what: string): number | null | false {
    if (!text.trim()) return null
    const cents = parseMoney(text)
    if (cents === null) {
      setProblem(`Type ${what} like 12.50, or leave it empty.`)
      return false
    }
    if (cents > MAX_PAID_CENTS) {
      setProblem(`That is more than the shelf can record (${moneyExact(MAX_PAID_CENTS)}).`)
      return false
    }
    return cents
  }

  function readDay(text: string): string | null | false {
    if (!text.trim()) return null
    const day = parseDay(text)
    if (day === null) {
      setProblem('Type the day as YYYY-MM-DD.')
      return false
    }
    return day
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const paidCents = readMoney(paid, 'what you paid')
    if (paidCents === false) return
    const acquiredOn = readDay(acquired)
    if (acquiredOn === false) return
    if (notes.length > MAX_NOTES) {
      setProblem(`Notes hold ${MAX_NOTES} characters; these are ${notes.length}.`)
      return
    }
    let soldCents: number | null = null
    let soldDay: string | null = null
    if (sold) {
      const c = readMoney(soldFor, 'what it sold for')
      if (c === false) return
      soldCents = c
      const d = readDay(soldOn)
      if (d === false) return
      soldDay = d ?? today()
    }
    const patch: CopyPatch = {
      condition,
      paid_cents: paidCents,
      acquired_on: acquiredOn,
      notes: notes.trim() ? notes.trim() : null,
      sold_cents: soldCents,
      sold_on: soldDay,
    }
    onClose()
    await account.updateCopy(copyId, patch)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-16">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="info-title" className="window animate-window relative w-full max-w-lg">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span id="info-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
            {title} Info
          </span>
        </div>

        <form onSubmit={save} className="flex gap-5 p-5">
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
                <span>{CONDITION_LABELS[condition]} copy</span>
              </p>
            </div>

            <div>
              <span className="eyebrow mb-1.5 block">Condition</span>
              <div className="flex" role="group" aria-label="Condition">
                {CONDITIONS.map((c, i) => (
                  <button
                    key={c}
                    ref={i === 0 ? firstRef : undefined}
                    type="button"
                    aria-pressed={condition === c}
                    className={toggle(condition === c)}
                    onClick={() => setCondition(c)}
                  >
                    {CONDITION_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="eyebrow mb-1.5 block">Paid</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-[var(--muted-foreground)]" aria-hidden>
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={paid}
                    onChange={(e) => {
                      setPaid(e.target.value)
                      setProblem(null)
                    }}
                    aria-label="Paid, in dollars"
                    placeholder="0.00"
                    className={`${macField} tabular w-full text-right`}
                  />
                </span>
              </label>
              <label className="block">
                <span className="eyebrow mb-1.5 block">Acquired on</span>
                <input
                  type="text"
                  value={acquired}
                  onChange={(e) => {
                    setAcquired(e.target.value)
                    setProblem(null)
                  }}
                  aria-label="Acquired on, as a day"
                  placeholder="YYYY-MM-DD"
                  className={`${macField} tabular w-full`}
                />
              </label>
            </div>

            <label className="block">
              <span className="eyebrow mb-1.5 flex justify-between">
                <span>Notes</span>
                <span className={notes.length > MAX_NOTES ? 'text-[var(--destructive)]' : ''}>
                  {notes.length}/{MAX_NOTES}
                </span>
              </span>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  setProblem(null)
                }}
                aria-label="Notes"
                rows={3}
                placeholder="Where it came from, a serial number, a loan…"
                className={`${macField} w-full resize-y`}
              />
            </label>

            <div className="space-y-3 border-t-2 border-dotted border-[var(--input)] pt-3">
              <MacCheckbox
                checked={sold}
                onChange={(v) => {
                  setSold(v)
                  setProblem(null)
                  if (v && !soldOn) setSoldOn(today())
                }}
              >
                Sold
              </MacCheckbox>
              {sold && (
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="eyebrow mb-1.5 block">Sold for</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm text-[var(--muted-foreground)]" aria-hidden>
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={soldFor}
                        onChange={(e) => {
                          setSoldFor(e.target.value)
                          setProblem(null)
                        }}
                        aria-label="Sold for, in dollars"
                        placeholder="0.00"
                        className={`${macField} tabular w-full text-right`}
                      />
                    </span>
                  </label>
                  <label className="block">
                    <span className="eyebrow mb-1.5 block">Sold on</span>
                    <input
                      type="text"
                      value={soldOn}
                      onChange={(e) => {
                        setSoldOn(e.target.value)
                        setProblem(null)
                      }}
                      aria-label="Sold on, as a day"
                      placeholder="YYYY-MM-DD"
                      className={`${macField} tabular w-full`}
                    />
                  </label>
                </div>
              )}
              <p className="text-[0.65rem] text-[var(--muted-foreground)]">
                A sold copy leaves the shelf value and shows under Sold with what it made.
              </p>
            </div>

            {problem && (
              <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
                {problem}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" className={macButton} onClick={onClose}>
                Cancel
              </button>
              <span className={defaultRing}>
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

/** Mounts the window whenever the provider has a copy to show info on. */
export function AccountCopyInfo() {
  const account = useAccount()
  if (!account.infoCopy) return null
  return (
    <CopyInfoDialog
      key={account.infoCopy.id}
      copyId={account.infoCopy.id}
      sell={account.infoCopy.sell}
      onClose={account.closeInfo}
    />
  )
}
