import { PLATFORM_MARKS } from '@/components/platform-marks'
import { PLATFORM_LABELS, type Platform } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PlatformMarkProps {
  platform: Platform
  className?: string
  /** Set where the platform is already named in text beside the mark, so it is not read out twice. */
  decorative?: boolean
}

/**
 * A console's wordmark as a 1-bit picture: one path in currentColor, so it
 * takes the ink of the window it sits in, in either palette.
 *
 * It is sized like type, by the font size, and each mark's height is set so
 * that all of them cover the same area. At one shared height the Game Boy
 * Advance mark would run four and a half times the length of the Game Boy
 * Color one. A height class overrides that; the width always follows.
 *
 * Site only: the marks are trademarks, so this is never a registry component.
 */
export function PlatformMark({ platform, className, decorative }: PlatformMarkProps) {
  const { w, h, d } = PLATFORM_MARKS[platform]
  const naming = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': PLATFORM_LABELS[platform] }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      height={`${h / 100}em`}
      fill="currentColor"
      className={cn('shrink-0', className)}
      {...naming}
    >
      <path d={d} />
    </svg>
  )
}
