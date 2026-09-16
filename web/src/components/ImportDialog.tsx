import { useEffect, useMemo, useRef, useState } from 'react'
import { messageOf, useAccount } from '@/lib/account'
import { parseCSV } from '@/lib/csv'
import { useJson } from '@/lib/data'
import { moneyExact } from '@/lib/format'
import { detectFormat, matchRows, readRows, toCopies, type ImportFormat, type ImportRow, type Match } from '@/lib/import'
import { CONDITION_LABELS, PLATFORM_LABELS, PLATFORM_SHORT, type CatalogFile } from '@/lib/types'
import { defaultRing, macButton } from '@/components/mac'
import { MacCheckbox } from '@/components/MacCheckbox'

const FORMAT_NAMES: Record<ImportFormat, string> = {
  retroheat: 'a RetroHeat export',
  gameye: 'a GAMEYE export',
  pricecharting: 'a PriceCharting collection',
}

type Phase = { kind: 'choose' } | { kind: 'review'; format: ImportFormat; rows: ImportRow[] } | { kind: 'done'; count: number }

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error ?? new Error('could not read the file'))
    r.readAsText(file)
  })
}

/**
 * Import Collection: a file from RetroHeat, GAMEYE or PriceCharting, read by
 * header name, matched against the catalog, and shown for review before a
 * single copy is written. What will come in, what needs a pick because the
 * title could be two games, and what is skipped and why, all on one list.
 * Opened from the File menu, so it holds its own open state like About.
 */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const account = useAccount()
  const catalog = useJson<CatalogFile>(open ? 'catalog.json' : null)
  const fileRef = useRef<HTMLInputElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })
  const [dedupe, setDedupe] = useState(true)
  const [picks, setPicks] = useState<Map<number, string>>(new Map())
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPhase({ kind: 'choose' })
    setPicks(new Map())
    setProblem(null)
    setBusy(false)
    restoreRef.current = document.activeElement
    const frame = requestAnimationFrame(() => firstRef.current?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      if (restoreRef.current instanceof HTMLElement && restoreRef.current.isConnected) restoreRef.current.focus()
    }
  }, [open, onOpenChange])

  const games = catalog.status === 'ready' ? catalog.data.games : []
  const existing = account.collection.status === 'ready' ? [...account.collection.data.values()] : []
  const matches = useMemo<Match[]>(() => {
    if (phase.kind !== 'review') return []
    return matchRows(phase.rows, games, { existing, dedupe }).map((m) => {
      if (m.kind !== 'pick') return m
      const chosen = picks.get(m.row.line)
      const game = chosen ? m.candidates.find((g) => g.id === chosen) : undefined
      return game ? { kind: 'match', row: m.row, game, score: 100 } : m
    })
    // existing is a fresh array each render; the shelf map behind it is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, games, account.collection, dedupe, picks])

  if (!open) return null

  const coming = matches.filter((m) => m.kind === 'match')
  const asking = matches.filter((m) => m.kind === 'pick')
  const skipped = matches.filter((m) => m.kind === 'skip')

  async function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProblem(null)
    let records: string[][]
    try {
      records = parseCSV(await readText(file))
    } catch (err) {
      setProblem(`The file could not be read: ${messageOf(err)}`)
      return
    }
    const header = records[0] ?? []
    const format = detectFormat(header)
    if (!format) {
      setProblem(
        `This is not a RetroHeat, GAMEYE or PriceCharting export. Its header starts: ${header.slice(0, 4).join(', ') || '(empty)'}.`,
      )
      return
    }
    setPicks(new Map())
    setPhase({ kind: 'review', format, rows: readRows(format, records) })
  }

  async function runImport() {
    setBusy(true)
    setProblem(null)
    try {
      const count = await account.addCopies(toCopies(matches))
      setPhase({ kind: 'done', count })
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const close = () => onOpenChange(false)

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-16">
      <div className="absolute inset-0 bg-black/30" onClick={close} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="window animate-window relative w-full max-w-2xl">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span id="import-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
            Import Collection
          </span>
        </div>

        <div className="flex gap-5 p-5">
          <span className="bevel mt-1 flex size-12 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)]" aria-hidden>
            <span className="flex size-full flex-col p-1">
              <span className="h-2 w-4 border border-b-0 border-[var(--border)] bg-[var(--muted)]" />
              <span className="flex-1 border border-[var(--border)] bg-[var(--card)]" />
            </span>
          </span>

          <div className="min-w-0 flex-1 space-y-4">
            {phase.kind === 'choose' && (
              <>
                <p className="pixel text-[0.6rem] leading-relaxed">Bring a shelf in from a file</p>
                <p className="text-xs">
                  RetroHeat's own export, a GAMEYE export (Exports → Collection on gameye.app) or a PriceCharting
                  collection CSV. Columns are read by name, so the order does not matter. Nothing is written until you
                  have seen what will come in.
                </p>
                <p className="text-[0.65rem] text-[var(--muted-foreground)]">
                  PriceCharting files are read on a best guess of their columns until a real export has been checked.
                </p>
                <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" aria-label="Collection file" className="sr-only" onChange={(e) => void chosen(e)} />
                <div className="flex items-center justify-end gap-3 pt-1">
                  <button type="button" className={macButton} onClick={close}>
                    Cancel
                  </button>
                  <span className={defaultRing}>
                    <button ref={firstRef} type="button" className={macButton} onClick={() => fileRef.current?.click()} disabled={catalog.status !== 'ready'}>
                      {catalog.status === 'ready' ? 'Choose File…' : 'Reading disk…'}
                    </button>
                  </span>
                </div>
              </>
            )}

            {phase.kind === 'review' && (
              <>
                <p className="pixel text-[0.6rem] leading-relaxed">Read as {FORMAT_NAMES[phase.format]}</p>
                <p className="text-xs font-semibold">
                  {coming.length} to import · {asking.length} {asking.length === 1 ? 'needs' : 'need'} a pick · {skipped.length} skipped
                </p>
                <MacCheckbox checked={dedupe} onChange={setDedupe}>
                  Skip copies already on the shelf in the same condition
                </MacCheckbox>

                <div className="pane bevel-in max-h-64 border-2 border-[var(--border)] bg-[var(--card)]">
                  <ul className="divide-y divide-dotted divide-[var(--input)] text-xs">
                    {asking.map((m) =>
                      m.kind === 'pick' ? (
                        <li key={m.row.line} className="space-y-1.5 p-2">
                          <p>
                            <span className="font-semibold">{m.row.title}</span>
                            <span className="eyebrow ml-2">
                              {m.row.platform ? PLATFORM_SHORT[m.row.platform] : m.row.platformName} · line {m.row.line} · which one?
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {m.candidates.map((g) => (
                              <button
                                key={g.id}
                                type="button"
                                className="press bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-[0.7rem] font-semibold"
                                aria-label={`Pick ${g.title}`}
                                onClick={() => setPicks((p) => new Map(p).set(m.row.line, g.id))}
                              >
                                {g.title}
                              </button>
                            ))}
                          </div>
                        </li>
                      ) : null,
                    )}
                    {coming.map((m) =>
                      m.kind === 'match' ? (
                        <li key={m.row.line} className="flex flex-wrap items-baseline justify-between gap-x-3 p-2">
                          <span>
                            <span className="font-semibold">{m.game.title}</span>
                            <span className="eyebrow ml-2">
                              {PLATFORM_SHORT[m.game.platform]} · {m.row.condition ? CONDITION_LABELS[m.row.condition] : ''}
                              {m.row.paid_cents != null && ` · paid ${moneyExact(m.row.paid_cents)}`}
                            </span>
                          </span>
                          {m.row.note && <span className="eyebrow text-[var(--muted-foreground)]">{m.row.note}</span>}
                        </li>
                      ) : null,
                    )}
                    {skipped.map((m) =>
                      m.kind === 'skip' ? (
                        <li key={m.row.line} className="flex flex-wrap items-baseline justify-between gap-x-3 p-2 text-[var(--muted-foreground)]">
                          <span>
                            <span className="line-through">{m.row.title || `line ${m.row.line}`}</span>
                            {m.row.platform && <span className="eyebrow ml-2">{PLATFORM_LABELS[m.row.platform]}</span>}
                          </span>
                          <span className="eyebrow">{m.reason}</span>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>

                {problem && (
                  <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
                    {problem}
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button type="button" className={macButton} onClick={close}>
                    Cancel
                  </button>
                  <span className={defaultRing}>
                    <button type="button" className={macButton} onClick={() => void runImport()} disabled={busy || coming.length === 0}>
                      {busy ? 'Importing…' : `Import ${coming.length} ${coming.length === 1 ? 'copy' : 'copies'}`}
                    </button>
                  </span>
                </div>
              </>
            )}

            {phase.kind === 'done' && (
              <>
                <p className="pixel text-[0.6rem] leading-relaxed">On the shelf</p>
                <p className="text-xs" role="status">
                  Imported {phase.count} {phase.count === 1 ? 'copy' : 'copies'}. Each is a row on the collection page,
                  with Get Info for the rest of its story.
                </p>
                <div className="flex items-center justify-end gap-3 pt-1">
                  <span className={defaultRing}>
                    <button type="button" className={macButton} onClick={close}>
                      Close
                    </button>
                  </span>
                </div>
              </>
            )}

            {phase.kind === 'choose' && problem && (
              <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
                {problem}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
