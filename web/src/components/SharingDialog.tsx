import { useEffect, useRef, useState } from 'react'
import { messageOf, useAccount } from '@/lib/account'
import { takeReturnFocus } from '@/lib/focus'
import { shareLink } from '@/lib/publicShelf'
import { SLUG_RE, slugify, type Profile } from '@/lib/shelf'
import { defaultRing, macButton, macField } from '@/components/mac'
import { MacCheckbox } from '@/components/MacCheckbox'

/**
 * Sharing: the one window where a shelf stops being private. A name for the
 * link, a box that opens the shelf to anyone holding it, a box that lets
 * the paid prices travel too. Private by default; nothing leaves until Save.
 * Built like the other windows opened from a menu, for the same reason.
 */
export function SharingDialog({ initial, loadError, onClose }: { initial: Profile | null; loadError: string | null; onClose: () => void }) {
  const account = useAccount()
  const nameRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<Element | null>(null)
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [isPublic, setPublic] = useState(initial?.is_public ?? false)
  const [sharePaid, setSharePaid] = useState(initial?.share_paid ?? false)
  const [problem, setProblem] = useState<string | null>(loadError)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    restoreRef.current = takeReturnFocus() ?? document.activeElement
    const frame = requestAnimationFrame(() => nameRef.current?.focus())
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

  const valid = SLUG_RE.test(slug)
  const link = valid ? shareLink(slug) : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) {
      setProblem('A shelf name is 3 to 32 lowercase letters, digits or hyphens.')
      return
    }
    setBusy(true)
    try {
      await account.saveProfile({ slug, is_public: isPublic, share_paid: sharePaid })
      onClose()
    } catch (err) {
      setProblem(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setProblem('The link could not be copied; select it and copy by hand.')
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-16">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="sharing-title" className="window animate-window relative w-full max-w-lg">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span id="sharing-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
            Sharing
          </span>
        </div>

        <form onSubmit={save} className="flex gap-5 p-5">
          <span className="bevel mt-1 flex size-12 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)]" aria-hidden>
            <span className="flex size-full flex-col p-1">
              <span className="h-2 w-4 border border-b-0 border-[var(--border)] bg-[var(--muted)]" />
              <span className="flex-1 border border-[var(--border)] bg-[var(--card)]" />
            </span>
          </span>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="pixel text-[0.6rem] leading-relaxed">
                {isPublic ? 'Anyone with the link can see your shelf' : 'Your shelf is private'}
              </p>
              <p className="mt-1 text-xs">
                What leaves is the list: game, condition and the day it joined. Notes never leave, sold copies never
                show, and what you paid only if you say so.
              </p>
            </div>

            <label className="block">
              <span className="eyebrow mb-1.5 block">Shelf name</span>
              <input
                ref={nameRef}
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value))
                  setProblem(null)
                  setCopied(false)
                }}
                aria-label="Shelf name"
                placeholder="my-shelf"
                autoComplete="off"
                spellCheck={false}
                className={`${macField} w-full`}
              />
              <span className="eyebrow mt-1 block">Lowercase letters, digits and hyphens · 3 to 32 characters</span>
            </label>

            <div className="space-y-2">
              <MacCheckbox
                checked={isPublic}
                onChange={(v) => {
                  setPublic(v)
                  setProblem(null)
                }}
              >
                Anyone with the link can see my shelf
              </MacCheckbox>
              <MacCheckbox checked={sharePaid} onChange={setSharePaid} className={isPublic ? '' : 'opacity-60'}>
                Include what I paid
              </MacCheckbox>
            </div>

            {isPublic && link && (
              <div className="bevel-in flex flex-wrap items-center justify-between gap-2 border-2 border-[var(--border)] px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
                <button type="button" className={macButton} onClick={() => void copy()}>
                  Copy
                </button>
                {copied && (
                  <span role="status" className="eyebrow w-full">
                    Copied
                  </span>
                )}
              </div>
            )}

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
                <button type="submit" className={macButton} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Mounts the window while the provider says it is open, once the choices have been read. */
export function AccountSharing() {
  const account = useAccount()
  if (!account.sharingOpen || account.profile.status === 'loading') return null
  const initial = account.profile.status === 'ready' ? account.profile.data : null
  const loadError = account.profile.status === 'error' ? `Your sharing choices could not be read: ${account.profile.error}` : null
  return <SharingDialog key={initial?.slug ?? 'new'} initial={initial} loadError={loadError} onClose={account.closeSharing} />
}
