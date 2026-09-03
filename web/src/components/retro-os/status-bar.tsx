import { cn } from '@/lib/utils'

interface StatusBarProps {
  /** A bevelled well on the left; hidden on narrow screens. */
  left?: React.ReactNode
  /** A bevelled well on the right. */
  right?: React.ReactNode
  /** The message in the middle; truncates rather than wraps. */
  children: React.ReactNode
  className?: string
}

/**
 * The system status strip along the bottom of the screen. An operating system
 * reports its state on a thin bar, not in a page footer, so whatever must
 * always be on screen belongs here.
 */
export function StatusBar({ left, right, children, className }: StatusBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-40 flex items-center justify-between gap-3 border-t-2 border-[var(--border)] px-2 py-1',
        className,
      )}
      style={{ background: 'var(--menubar)' }}
    >
      {left !== undefined && (
        <span className="bevel-in hidden shrink-0 border border-[var(--border)] px-2 py-0.5 sm:block">
          <span className="eyebrow">{left}</span>
        </span>
      )}

      <p className="min-w-0 flex-1 truncate text-[0.7rem]">{children}</p>

      {right !== undefined && (
        <span className="bevel-in shrink-0 border border-[var(--border)] px-2 py-0.5">
          <span className="eyebrow">{right}</span>
        </span>
      )}
    </div>
  )
}
