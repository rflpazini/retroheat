import { useEffect, useState } from 'react'

const KEY = 'retroheat-booted'

// matchMedia is missing in some embedded and test environments, and a missing
// media query must never take the page down with it.
function prefersReducedMotion() {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A startup screen, shown once per session. It is pure theatre, so it is
 * skipped entirely for anyone who asked for reduced motion, can be dismissed
 * with a click or any key, and never blocks the data behind it from loading.
 */
export function BootScreen() {
  const [done, setDone] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1' || prefersReducedMotion()
    } catch {
      return prefersReducedMotion()
    }
  })

  useEffect(() => {
    if (done) return

    const finish = () => {
      setDone(true)
      try {
        sessionStorage.setItem(KEY, '1')
      } catch {
        // Private browsing; the screen simply shows again next time.
      }
    }

    const timer = setTimeout(finish, 1700)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [done])

  if (done) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--desktop)]"
      role="status"
      aria-label="Starting RetroHeat"
    >
      <div className="window animate-window w-[22rem] max-w-[90vw]">
        <div className="window-title flex items-center justify-center px-2 py-1">
          <span className="window-title-text pixel text-[0.5rem] uppercase">Welcome</span>
        </div>
        <div className="stripe" aria-hidden />
        <div className="p-5 text-center">
          <p className="pixel mb-1 text-[0.7rem]">RetroHeat</p>
          <p className="mb-4 text-[0.7rem]">Retro game price momentum</p>
          <div className="bevel-in h-4 border-2 border-[var(--border)] bg-[var(--muted)]">
            <div className="progress-fill h-full" style={{ background: 'var(--stripe-4)' }} />
          </div>
          <p className="eyebrow mt-3">
            Loading catalog<span className="blink">_</span>
          </p>
        </div>
      </div>
    </div>
  )
}
