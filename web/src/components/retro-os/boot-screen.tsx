import { useEffect, useState } from 'react'

// matchMedia is missing in some embedded and test environments, and a missing
// media query must never take the page down with it.
function prefersReducedMotion() {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface BootScreenProps {
  /** The product name on the splash. */
  name: string
  tagline?: string
  /** The status line under the progress bar; a blinking cursor is appended. */
  status?: string
  /** The window title. */
  title?: string
  /** How long the splash stays, in milliseconds. */
  duration?: number
  /**
   * sessionStorage key that records the splash has been shown, so it plays
   * once per tab. Pass null to show it on every load.
   */
  storageKey?: string | null
  /** The bar's fill colour. */
  barColor?: string
}

/**
 * A startup screen, shown once per session. It is pure theatre, so it is
 * skipped entirely for anyone who asked for reduced motion, can be dismissed
 * with a click or any key, and never blocks the page behind it from loading.
 */
export function BootScreen({
  name,
  tagline,
  status = 'Loading',
  title = 'Welcome',
  duration = 1700,
  storageKey = 'retro-os-booted',
  barColor = 'var(--stripe-4)',
}: BootScreenProps) {
  const [done, setDone] = useState(() => {
    try {
      return (storageKey !== null && sessionStorage.getItem(storageKey) === '1') || prefersReducedMotion()
    } catch {
      return prefersReducedMotion()
    }
  })

  useEffect(() => {
    if (done) return

    const finish = () => {
      setDone(true)
      if (storageKey === null) return
      try {
        sessionStorage.setItem(storageKey, '1')
      } catch {
        // Private browsing; the screen simply shows again next time.
      }
    }

    const timer = setTimeout(finish, duration)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [done, duration, storageKey])

  if (done) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--desktop)]"
      role="status"
      aria-label={`Starting ${name}`}
    >
      <div className="window animate-window w-[22rem] max-w-[90vw]">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span className="window-title-text pixel text-[0.5rem] uppercase">{title}</span>
        </div>
        <div className="stripe" aria-hidden />
        <div className="p-5 text-center">
          <p className="pixel mb-1 text-[0.7rem]">{name}</p>
          {tagline && <p className="mb-4 text-[0.7rem]">{tagline}</p>}
          <div className="bevel-in h-4 border-2 border-[var(--border)] bg-[var(--muted)]">
            <div className="progress-fill h-full" style={{ background: barColor }} />
          </div>
          <p className="eyebrow mt-3">
            {status}
            <span className="blink">_</span>
          </p>
        </div>
      </div>
    </div>
  )
}
