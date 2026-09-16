import { cn } from '@/lib/utils'

/**
 * A System 7 check box: a small sunken square that takes an X, with its
 * label beside it. One button, so the label is the accessible name and the
 * whole thing toggles on a click or a space.
 */
export function MacCheckbox({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex items-center gap-2 text-xs font-semibold', className)}
    >
      <span
        className="bevel-in inline-flex size-3.5 shrink-0 items-center justify-center border-2 border-[var(--border)] bg-[var(--card)] leading-none"
        aria-hidden
      >
        {checked && <span className="text-[0.7rem] font-bold leading-none">×</span>}
      </span>
      {children}
    </button>
  )
}
