import { useEffect, useRef, useState } from 'react'
import { messageOf, useAccount } from '@/lib/account'

const btn =
  'press bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5'
const field = 'bevel-in w-full border-2 border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs outline-none'

type Phase = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

/**
 * The sign-in window: Google, or a magic link by email. No passwords, so
 * nothing to reset. Built like AboutDialog rather than on the dialog
 * primitive, for the same reason: it opens from the menu bar, and a menu's
 * focus restore fights a primitive's focus trap.
 */
export function SignInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const account = useAccount()
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  useEffect(() => {
    if (!open) return
    setPhase({ kind: 'idle' })
    restoreRef.current = document.activeElement
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus()
    }
  }, [open, onOpenChange])

  if (!open) return null

  const failure = phase.kind === 'error' ? phase.message : account.signInError

  async function google() {
    setPhase({ kind: 'sending' })
    try {
      await account.signInWithGoogle()
    } catch (e) {
      setPhase({ kind: 'error', message: messageOf(e) })
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    setPhase({ kind: 'sending' })
    try {
      await account.signInWithEmail(address)
      setPhase({ kind: 'sent', email: address })
    } catch (err) {
      setPhase({ kind: 'error', message: messageOf(err) })
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-24">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="window animate-window relative w-full max-w-md"
      >
        <div className="window-title flex items-center gap-2 px-2 py-1">
          <button
            ref={closeRef}
            onClick={() => onOpenChange(false)}
            className="title-box press shrink-0"
            aria-label="Close sign in window"
          />
          <span className="flex min-w-0 flex-1 justify-center">
            <span id="signin-title" className="window-title-text pixel truncate text-[0.5rem] uppercase">
              Sign In
            </span>
          </span>
          <span className="title-box shrink-0" aria-hidden />
        </div>
        <div className="stripe" aria-hidden />

        <div className="space-y-4 p-5">
          <p className="text-xs">
            Save games and keep track of what you own. RetroHeat stores your e-mail address and the
            ids of the games you save, nothing else.
          </p>

          {phase.kind === 'sent' ? (
            <div className="bevel-in border-2 border-[var(--border)] p-3 text-xs">
              <p className="pixel mb-2 text-[0.6rem]">Check your inbox</p>
              <p>
                A sign-in link is on its way to <strong>{phase.email}</strong>. Open it on this device,
                in this browser: it only works where it was requested.
              </p>
            </div>
          ) : (
            <>
              <button type="button" className={btn} onClick={google} disabled={phase.kind === 'sending'}>
                {phase.kind === 'sending' ? 'One moment…' : 'Continue with Google'}
              </button>

              <p className="eyebrow">or</p>

              <form onSubmit={submit} className="space-y-2">
                <label className="block">
                  <span className="eyebrow mb-1.5 block">E-mail address</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={field}
                    placeholder="you@example.com"
                  />
                </label>
                <button type="submit" className={btn} disabled={phase.kind === 'sending'}>
                  Send magic link
                </button>
              </form>
            </>
          )}

          {failure && (
            <p role="alert" className="text-xs font-semibold text-[var(--destructive)]">
              {failure}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Mounts the sign-in window wherever the provider says it should be open. */
export function AccountSignIn() {
  const account = useAccount()
  if (account.status === 'disabled') return null
  return (
    <SignInDialog
      open={account.signInOpen}
      onOpenChange={(v) => (v ? account.openSignIn() : account.closeSignIn())}
    />
  )
}
