import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { ScanBarcode, Flashlight } from 'lucide-react'
import { useAccount } from '@/lib/account'
import { formatBarcode, lookupBarcode, normalizeBarcode, type BarcodeHit, type BarcodeIndexFile } from '@/lib/barcode'
import { useJson } from '@/lib/data'
import { takeReturnFocus } from '@/lib/focus'
import { conditionColor, moneyExact, parseMoney } from '@/lib/format'
import { usePriceIndex } from '@/lib/prices'
import { browserScanDeps, beep, cameraProblem, stopStream, torchOf, type Detector, type ScanDeps } from '@/lib/scanner'
import { rank } from '@/lib/search'
import { MAX_PAID_CENTS } from '@/lib/shelf'
import {
  CONDITIONS,
  CONDITION_LABELS,
  EDITION_LABELS,
  PLATFORM_SHORT,
  type CatalogFile,
  type CatalogGame,
  type Condition,
  type Edition,
} from '@/lib/types'
import { defaultRing, macButton, macField } from '@/components/mac'

const toggle = (active: boolean) =>
  `press border-2 border-[var(--border)] px-3 py-1 text-xs font-semibold ${
    active ? 'bevel-in bg-[var(--accent)] text-[var(--accent-foreground)]' : 'bevel bg-[var(--secondary)]'
  }`

/** How many looks without the code it just handled before the same box may be read again. */
const AWAY_FRAMES = 3

/** A game to confirm; paired when the person picked it for a code the catalog did not know, or corrected it. */
type Found = { kind: 'found'; code: string | null; hit: BarcodeHit; game: CatalogGame; paired: boolean }

type Phase = { kind: 'scanning' } | { kind: 'typing' } | { kind: 'unknown'; code: string } | Found

type Camera = { kind: 'starting' } | { kind: 'live' } | { kind: 'problem'; text: string }

interface Added {
  key: string
  /** Absent on a store from before copies had ids (0004): the copy landed, but cannot be undone from here. */
  copyId?: string
  title: string
  condition: Condition
  edition: Edition | null
}

/**
 * The scanner: point the phone at the barcode on the back of a box, confirm
 * the game it found, and the copy is on the shelf; the camera then waits for
 * the next box, so a whole shelf goes in one sitting. A barcode the catalog
 * does not know is paired by hand, once, and remembered. Built like the other
 * account windows, a System 7 movable modal, because it opens from a menu.
 */
export function ScanDialog({ onClose, deps = browserScanDeps }: { onClose: () => void; deps?: ScanDeps }) {
  const account = useAccount()
  const catalog = useJson<CatalogFile>('catalog.json')
  // Until the collector has written barcodes, the file is missing; that is
  // an index with nothing in it, not a failure.
  const indexFile = useJson<BarcodeIndexFile>('barcodes.json')
  const { index: prices } = usePriceIndex()
  const index = indexFile.status === 'ready' ? indexFile.data : null

  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' })
  const [camera, setCamera] = useState<Camera>({ kind: 'starting' })
  const [detector, setDetector] = useState<Detector | 'failed' | null>(null)
  const [pairs, setPairs] = useState<Map<string, string> | null>(null)
  const [added, setAdded] = useState<Added[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [torch, setTorch] = useState<{ set: (on: boolean) => Promise<void>; on: boolean } | null>(null)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const [undoing, setUndoing] = useState<Set<string>>(() => new Set())

  const windowRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<Element | null>(null)
  // The last code handled stays ignored until the box has left the frame,
  // or the same box would be read again the moment the camera resumes.
  const handled = useRef<{ code: string; away: number } | null>(null)
  // The step on screen now, for a write that comes back after the person moved on.
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const games = useMemo(() => (catalog.status === 'ready' ? catalog.data.games : []), [catalog])
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games])
  const settled = catalog.status !== 'loading' && indexFile.status !== 'loading' && pairs !== null

  // Once per opening. A slow store must not hold the camera up: after a few
  // seconds scanning starts on the catalog alone, and the pairings join when
  // they come, with any made since the window opened winning over them.
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => live && setPairs((p) => p ?? new Map()), deps.pairsTimeout)
    void account.barcodePairs().then((list) => {
      if (!live) return
      clearTimeout(timer)
      setPairs((p) => {
        const merged = new Map(list.map((x) => [x.code, x.game_id]))
        for (const [code, id] of p ?? []) merged.set(code, id)
        return merged
      })
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let live = true
    deps.loadDetector().then(
      (d) => live && setDetector(d),
      () => live && setDetector('failed'),
    )
    return () => {
      live = false
    }
  }, [deps])

  // The camera runs while the window is open and the page is in view; a
  // phone locked or switched away lets it go, and it comes back on return.
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (hidden) return
    let live = true
    setCamera({ kind: 'starting' })
    deps.openCamera().then(
      (stream) => {
        if (!live) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          try {
            void Promise.resolve(video.play()).catch(() => {})
          } catch {
            // A browser that plays on its own (autoplay) needs no nudge.
          }
        }
        const set = torchOf(stream)
        setTorch(set ? { set, on: false } : null)
        setCamera({ kind: 'live' })
      },
      (e: unknown) => live && setCamera({ kind: 'problem', text: cameraProblem(e) }),
    )
    return () => {
      live = false
      stopStream(streamRef.current)
      streamRef.current = null
      setTorch(null)
    }
  }, [deps, hidden])

  useEffect(() => {
    restoreRef.current = takeReturnFocus() ?? document.activeElement
    const frame = requestAnimationFrame(() => doneRef.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (restoreRef.current instanceof HTMLElement && restoreRef.current.isConnected) restoreRef.current.focus()
    }
  }, [])

  // A code becomes a step, or, when the lists it is matched against did not
  // load, a notice and no step: a known box offered for pairing by hand
  // because the catalog was missing would be paired wrong. Says whether it
  // moved on. A missing barcodes.json (404) is an empty index, not a failure.
  const resolve = useCallback(
    (code: string): boolean => {
      handled.current = { code, away: 0 }
      if (byId.size === 0) {
        setNotice('The game list did not load, so this box cannot be matched yet. Reload when you have a signal.')
        return false
      }
      if (indexFile.status === 'error' && indexFile.error !== '404') {
        setNotice('The barcode list did not load, so this box cannot be matched yet. Reload when you have a signal.')
        return false
      }
      setNotice(null)
      const hit = lookupBarcode(code, index, pairs ?? new Map())
      const game = hit ? byId.get(hit.id) : undefined
      setPhase(hit && game ? { kind: 'found', code, hit, game, paired: false } : { kind: 'unknown', code })
      return true
    },
    [index, indexFile, pairs, byId],
  )
  // The loop reads through this, so new pairings or a late index do not
  // restart it and lose a read halfway through its confirmation.
  const onRead = useEffectEvent((code: string) => resolve(code))

  // The look loop: one frame every interval while scanning. A code counts
  // once two looks in a row agree, which is how a smudge is told from a read.
  const reader = detector === 'failed' ? null : detector
  const scanning = phase.kind === 'scanning' && camera.kind === 'live' && reader !== null && settled
  useEffect(() => {
    if (!scanning || !reader) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    let previous: string | null = null
    const look = async () => {
      const video = videoRef.current
      let code: string | null = null
      if (video) {
        try {
          for (const d of await reader.detect(video)) {
            code = normalizeBarcode(d.rawValue, d.format)
            if (code) break
          }
        } catch {
          // A frame the detector cannot read yet (the video still starting) is just a miss.
        }
      }
      if (!live) return
      const last = handled.current
      if (last && code !== last.code) {
        last.away++
        if (last.away >= AWAY_FRAMES) handled.current = null
      }
      if (code && code !== handled.current?.code) {
        if (code === previous) {
          beep()
          if (onRead(code)) return
        }
        previous = code
      } else {
        previous = null
      }
      timer = setTimeout(look, deps.interval)
    }
    timer = setTimeout(look, deps.interval)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [scanning, reader, deps.interval])

  const backToScanning = useCallback(() => {
    setPhase({ kind: 'scanning' })
    requestAnimationFrame(() => doneRef.current?.focus())
  }, [])

  // Escape is Cancel: out of a step back to the camera, out of the camera, closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phase.kind === 'scanning') onClose()
      else backToScanning()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase.kind, onClose, backToScanning])

  async function readPhoto(file: File) {
    setNotice(null)
    if (!reader) {
      setNotice(
        detector === 'failed'
          ? 'The barcode reader did not load, so photos cannot be read either. Type the number under the bars.'
          : 'The barcode reader is still loading; try the photo again in a moment.',
      )
      return
    }
    try {
      const image = await deps.imageOf(file)
      for (const d of await reader.detect(image)) {
        const code = normalizeBarcode(d.rawValue, d.format)
        if (code) {
          // A refusal leaves its own notice.
          resolve(code)
          return
        }
      }
    } catch {
      // Unreadable files read as no barcode.
    }
    setNotice('No barcode was found in that photo. Take it closer, with the bars level and in focus.')
  }

  async function add(step: Found, condition: Condition, paid: number | null) {
    const { game, hit, code } = step
    const row = await account.addCopy(game.id, condition, {
      paid_cents: paid,
      edition: hit.variant,
      barcode: code,
      quiet: true,
    })
    if (!row) {
      setNotice(`${game.title} was not added; the status strip says why.`)
      return
    }
    const key = row.id ?? `added-${game.id}-${row.added_at}`
    setAdded((list) => [{ key, copyId: row.id, title: game.title, condition, edition: hit.variant }, ...list])
    if (step.paired && code) setPairs((p) => new Map(p).set(code, game.id))
    // Back to the camera only from the step this add began on: a person who
    // went on to the next box while the write was on its way keeps that box.
    // Focus goes to the window, not Done, so a second Return closes nothing.
    if (phaseRef.current === step) {
      setPhase((p) => (p === step ? { kind: 'scanning' } : p))
      requestAnimationFrame(() => windowRef.current?.focus())
    }
    // The pairing needs no wait; a failure says so on the status strip.
    if (step.paired && code) void account.saveBarcodePair(code, game.id)
  }

  // The row leaves the list only once the copy has left the shelf.
  async function undo(item: Added) {
    const copyId = item.copyId
    if (!copyId) return
    setUndoing((s) => new Set(s).add(copyId))
    const removed = await account.removeCopy(copyId)
    setUndoing((s) => {
      const next = new Set(s)
      next.delete(copyId)
      return next
    })
    if (removed) setAdded((list) => list.filter((a) => a.key !== item.key))
    else setNotice(`${item.title} was not taken off the shelf; the status strip says why.`)
  }

  const status =
    detector === 'failed'
      ? 'The barcode reader did not load. Type the number under the bars instead.'
      : camera.kind === 'problem'
        ? camera.text
        : camera.kind === 'starting' || !reader || !settled
          ? 'Starting the camera…'
          : 'Point the camera at the barcode on the back of the case.'

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-3 pt-10 sm:p-4 sm:pt-16">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        tabIndex={-1}
        className="window animate-window relative w-full max-w-md outline-none"
      >
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span id="scan-title" className="window-title-text pixel flex items-center gap-1.5 truncate text-[0.5rem] uppercase">
            <ScanBarcode className="size-3 shrink-0" aria-hidden />
            Scan Barcode
          </span>
        </div>

        <div className="space-y-3 p-4">
          {/* The video stays mounted while a step is up, so the camera resumes at once. */}
          <div className={phase.kind === 'scanning' ? 'space-y-3' : 'hidden'}>
            <div className="bevel-in relative aspect-[4/3] w-full overflow-hidden border-2 border-[var(--border)] bg-black">
              <video ref={videoRef} className="size-full object-cover" muted playsInline autoPlay aria-label="Camera" />
              {camera.kind === 'live' && (
                <div className="pointer-events-none absolute inset-[12%_8%]" aria-hidden>
                  <span className="absolute top-0 left-0 size-5 border-t-2 border-l-2 border-white" />
                  <span className="absolute top-0 right-0 size-5 border-t-2 border-r-2 border-white" />
                  <span className="absolute bottom-0 left-0 size-5 border-b-2 border-l-2 border-white" />
                  <span className="absolute right-0 bottom-0 size-5 border-r-2 border-b-2 border-white" />
                  <span className="absolute inset-x-2 top-1/2 h-0.5 bg-[var(--destructive)]" />
                </div>
              )}
              {camera.kind !== 'live' && (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <ScanBarcode className="size-10 text-white/60" aria-hidden />
                </div>
              )}
            </div>
            <p className="text-xs" role="status">
              {status}
            </p>
          </div>

          {notice && (
            <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
              {notice}
            </p>
          )}

          {phase.kind === 'found' && (
            <Confirm
              key={`${phase.code}:${phase.game.id}`}
              game={phase.game}
              hit={phase.hit}
              code={phase.code}
              held={account.copiesOf(phase.game.id).map((c) => c.condition)}
              asking={(c) => prices.get(phase.game.id)?.prices[c] ?? null}
              onAdd={(condition, paid) => add(phase, condition, paid)}
              onSkip={backToScanning}
              onWrongGame={phase.code ? () => setPhase({ kind: 'unknown', code: phase.code! }) : undefined}
            />
          )}

          {phase.kind === 'unknown' && (
            <Pair
              code={phase.code}
              games={games}
              onPick={(game) => setPhase({ kind: 'found', code: phase.code, hit: { id: game.id, variant: null }, game, paired: true })}
              onSkip={backToScanning}
            />
          )}

          {phase.kind === 'typing' && <TypeNumber onCode={(code) => void resolve(code)} onCancel={backToScanning} />}

          {phase.kind === 'scanning' && (
            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              {torch && (
                <button
                  type="button"
                  className={`${macButton} mr-auto inline-flex items-center gap-1.5`}
                  aria-pressed={torch.on}
                  onClick={() => {
                    const on = !torch.on
                    void torch.set(on).then(
                      () => setTorch({ ...torch, on }),
                      () => {},
                    )
                  }}
                >
                  <Flashlight className="size-3.5" aria-hidden />
                  Light
                </button>
              )}
              {/* Not before the lists a code is matched against are in, or a known box could be offered for pairing. */}
              <button type="button" className={macButton} disabled={!settled} onClick={() => setPhase({ kind: 'typing' })}>
                Type Number…
              </button>
              <button type="button" className={macButton} disabled={!settled} onClick={() => photoRef.current?.click()}>
                Choose Photo…
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Photo of a barcode"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void readPhoto(file)
                }}
              />
              <span className={defaultRing}>
                <button ref={doneRef} type="button" className={macButton} onClick={onClose}>
                  Done
                </button>
              </span>
            </div>
          )}

          {added.length > 0 && (
            <div className="border-t-2 border-dotted border-[var(--input)] pt-3">
              <p className="eyebrow mb-1.5">Added this session · {added.length}</p>
              <ul className="divide-y divide-dotted divide-[var(--input)]" aria-label="Added this session">
                {added.map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="min-w-0">
                      <span className="font-semibold">{a.title}</span>
                      <span className="eyebrow ml-2">
                        {CONDITION_LABELS[a.condition]}
                        {a.edition && ` · ${EDITION_LABELS[a.edition]}`}
                      </span>
                    </span>
                    {a.copyId && (
                      <button
                        type="button"
                        className={macButton}
                        disabled={undoing.has(a.copyId)}
                        onClick={() => void undo(a)}
                        aria-label={`Undo ${a.title}`}
                      >
                        Undo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The game a code belongs to, and the two questions a copy needs: what shape it is in, and what it cost. */
function Confirm({
  game,
  hit,
  code,
  held,
  asking,
  onAdd,
  onSkip,
  onWrongGame,
}: {
  game: CatalogGame
  hit: BarcodeHit
  code: string | null
  held: Condition[]
  asking: (c: Condition) => number | null
  onAdd: (condition: Condition, paid: number | null) => Promise<void>
  onSkip: () => void
  onWrongGame?: () => void
}) {
  // A box in hand is most often complete; a sealed one or a bare cart is one tap away.
  const [condition, setCondition] = useState<Condition>('cib')
  const [paid, setPaid] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set before the first await, so a second Return or click in the same
  // moment finds the write already under way and adds nothing.
  const pending = useRef(false)
  const addRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => addRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending.current) return
    let cents: number | null = null
    if (paid.trim()) {
      cents = parseMoney(paid)
      if (cents === null) {
        setProblem('Type a price like 12.50, or leave it empty.')
        return
      }
      if (cents > MAX_PAID_CENTS) {
        setProblem(`That is more than the shelf can record (${moneyExact(MAX_PAID_CENTS)}).`)
        return
      }
    }
    pending.current = true
    setBusy(true)
    try {
      await onAdd(condition, cents)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const price = asking(condition)
  const count = held.length
  return (
    <form onSubmit={submit} className="space-y-3" aria-label={`Add ${game.title}`}>
      <div className="flex gap-4">
        <span className="bevel flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden border-2 border-[var(--border)] bg-[var(--secondary)]">
          {game.info?.cover_url ? (
            <img src={game.info.cover_url} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <ScanBarcode className="size-6" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="pixel text-[0.6rem] leading-relaxed">{game.title}</p>
            <p className="eyebrow mt-1">
              {PLATFORM_SHORT[game.platform]}
              {hit.variant && ` · ${EDITION_LABELS[hit.variant]}`}
              {code && ` · ${formatBarcode(code)}`}
            </p>
            {count > 0 && (
              <p className="mt-1 text-xs">
                Already on your shelf: {count} {count === 1 ? 'copy' : 'copies'} (
                {[...new Set(held)].map((c) => CONDITION_LABELS[c]).join(', ')})
              </p>
            )}
          </div>

          <div className="flex" role="group" aria-label="Condition">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={condition === c}
                className={toggle(condition === c)}
                onClick={() => setCondition(c)}
              >
                {CONDITION_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="block">
              <span className="eyebrow mb-1 block">Paid</span>
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
                  aria-label={`Paid for ${game.title}, in dollars`}
                  placeholder="0.00"
                  className={`${macField} tabular w-24 text-right`}
                />
              </span>
            </label>
            <p className="eyebrow flex items-center gap-1.5 pb-2">
              <span className="size-2 border border-[var(--border)]" style={{ background: conditionColor(condition) }} aria-hidden />
              {price === null ? 'no price at this condition' : `asking ${moneyExact(price)} today`}
            </p>
          </div>
        </div>
      </div>

      {problem && (
        <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
        {onWrongGame && (
          <button type="button" className={`${macButton} mr-auto`} onClick={onWrongGame}>
            Wrong Game…
          </button>
        )}
        <button type="button" className={macButton} onClick={onSkip}>
          Skip
        </button>
        <span className={defaultRing}>
          <button ref={addRef} type="submit" className={macButton} disabled={busy}>
            Add to Shelf
          </button>
        </span>
      </div>
    </form>
  )
}

/** A code nobody has paired yet: find the game by title, and the pairing is remembered for next time. */
function Pair({
  code,
  games,
  onPick,
  onSkip,
}: {
  code: string
  games: CatalogGame[]
  onPick: (game: CatalogGame) => void
  onSkip: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (query.trim() ? rank(query, games, 6) : []), [query, games])

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="space-y-3">
      <div>
        <p className="pixel text-[0.6rem] leading-relaxed">Which game is this?</p>
        <p className="mt-1 text-xs">
          RetroHeat does not know <span className="tabular font-semibold">{formatBarcode(code)}</span> yet. Find the game, and the next scan
          of this box will know it.
        </p>
      </div>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Find the game"
        placeholder="Title, or title + platform: bully ps2"
        autoComplete="off"
        className={`${macField} w-full`}
      />
      {hits.length > 0 && (
        <ul className="divide-y divide-dotted divide-[var(--input)]" aria-label="Matching games">
          {hits.map(({ item: g }) => (
            <li key={g.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left text-xs hover:bg-[var(--secondary)]"
                onClick={() => onPick(g)}
              >
                <span className="font-semibold">{g.title}</span>
                <span className="eyebrow">{PLATFORM_SHORT[g.platform]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && hits.length === 0 && <p className="eyebrow">No tracked game matches “{query}”.</p>}
      <div className="flex justify-end pt-1">
        <button type="button" className={macButton} onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  )
}

/** The digits under the bars, typed: for a camera that will not focus, or no camera at all. */
function TypeNumber({ onCode, onCancel }: { onCode: (code: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        const code = normalizeBarcode(text)
        if (!code) {
          setProblem('That is not a whole barcode. Type all 12 or 13 digits under the bars, the small ones at the ends included.')
          return
        }
        onCode(code)
      }}
    >
      <label className="block">
        <span className="eyebrow mb-1.5 block">The number under the bars</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setProblem(null)
          }}
          placeholder="0 83717 20025 3"
          autoComplete="off"
          className={`${macField} tabular w-full`}
        />
      </label>
      {problem && (
        <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
          {problem}
        </p>
      )}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button type="button" className={macButton} onClick={onCancel}>
          Cancel
        </button>
        <span className={defaultRing}>
          <button type="submit" className={macButton}>
            Find
          </button>
        </span>
      </div>
    </form>
  )
}
