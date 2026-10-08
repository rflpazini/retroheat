import type { ReactNode } from 'react'
import type { Platform } from '@/lib/types'
import { cn } from '@/lib/utils'

/*
  Each console as a small line drawing, made the way lucide makes the icons
  around it: a 24-unit grid, a 2-unit stroke in the text colour, round ends,
  no fill. At 16px only the outline survives, so each one is the silhouette a
  collector knows: the standing PS2, the original PS3's domed lid, the cube
  with its disc lid, the N64's three-pronged pad, the Dreamcast pad with its
  memory-card slot, and the handhelds by shape and screen.

  These are drawings of the hardware, not the consoles' logos; the wordmarks
  live in platform-marks.ts.
*/
export const CONSOLE_SHAPES: Record<Platform, ReactNode> = {
  ps2: (
    <>
      <rect x="8" y="2" width="8" height="17" rx="1" />
      <path d="M6 22l2-3" />
      <path d="M18 22l-2-3" />
      <path d="M8 5.5h8" />
      <path d="M11 9v7" />
      <path d="M13.5 9v7" />
    </>
  ),
  ps3: (
    <>
      <path d="M2 18v-7.5q10-4.5 20 0V18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      <path d="M6 13.5h12" />
    </>
  ),
  gamecube: (
    <>
      <path d="M12 2 21 7v10l-9 5-9-5V7z" />
      <path d="m3 7 9 5 9-5" />
      <path d="M12 12v10" />
      <ellipse cx="12" cy="7" rx="4" ry="2" />
    </>
  ),
  psp: (
    <>
      <rect x="1" y="7" width="22" height="10" rx="5" />
      <rect x="7" y="9.5" width="10" height="5" rx=".5" />
      <path d="M4 12h.01" />
      <path d="M20 12h.01" />
    </>
  ),
  vita: (
    <>
      <rect x="1" y="6" width="22" height="12" rx="6" />
      <rect x="7" y="8.5" width="10" height="7" rx="1" />
      <path d="M4.5 10.5h.01" />
      <path d="M19.5 10.5h.01" />
      <path d="M4.5 14h.01" />
      <path d="M19.5 14h.01" />
    </>
  ),
  n64: (
    <>
      <path d="M2 9a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a2 2 0 0 1-4 0v-4h-3v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H6v4a2 2 0 0 1-4 0z" />
      <path d="M5 9h2" />
      <path d="M6 8v2" />
      <path d="M17 8h.01" />
      <path d="M19 10h.01" />
    </>
  ),
  dreamcast: (
    <>
      <path d="M5 4h14a3 3 0 0 1 3 3v5a7 7 0 0 1-3.5 6V21H15v-3H9v3H5.5v-3A7 7 0 0 1 2 12V7a3 3 0 0 1 3-3z" />
      <rect x="9" y="4" width="6" height="7" rx=".5" />
      <path d="M5.5 8h.01" />
      <path d="M18.5 8h.01" />
    </>
  ),
  gb: (
    <>
      <path d="M7 2h10a2 2 0 0 1 2 2v12a6 6 0 0 1-6 6H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <rect x="8" y="5" width="8" height="6" rx="1" />
      <path d="M8 16h3" />
      <path d="M9.5 14.5v3" />
      <path d="M14 17h.01" />
      <path d="M16 15h.01" />
    </>
  ),
  gbc: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="4" />
      <path d="M8 5h8v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" />
      <path d="M8 16h3" />
      <path d="M9.5 14.5v3" />
      <path d="M14 17h.01" />
      <path d="M16 15h.01" />
    </>
  ),
  gba: (
    <>
      <rect x="1" y="6" width="22" height="12" rx="4" />
      <rect x="8" y="8.5" width="8" height="7" rx="1" />
      <path d="M3.5 12h2" />
      <path d="M4.5 11v2" />
      <path d="M19 11h.01" />
      <path d="M20.5 13h.01" />
    </>
  ),
}

/** A console's line icon; decorative, since its name always sits beside it. */
export function ConsoleIcon({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4 shrink-0', className)}
      aria-hidden
    >
      {CONSOLE_SHAPES[platform]}
    </svg>
  )
}
