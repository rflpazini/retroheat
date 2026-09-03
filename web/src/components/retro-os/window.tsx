import { cn } from '@/lib/utils'

interface TitleBarProps {
  title: React.ReactNode
  /** When given, the left box becomes a real close button. */
  onClose?: () => void
  closeLabel?: string
  /** Id for the title text, for aria-labelledby on a dialog. */
  titleId?: string
  className?: string
  /** The arcade stripe under the title bar. */
  stripe?: boolean
}

/**
 * A System 7 title bar: horizontal pinstripes with the title punched out of
 * them, a close box on the left and a zoom box on the right. The boxes are
 * scenery unless onClose is given, in which case the left one is a button.
 */
export function TitleBar({ title, onClose, closeLabel = 'Close', titleId, className, stripe }: TitleBarProps) {
  return (
    <>
      <div className={cn('window-title flex items-center gap-2 px-2 py-1', className)}>
        {onClose ? (
          <button type="button" onClick={onClose} className="title-box press shrink-0" aria-label={closeLabel} />
        ) : (
          <span className="title-box shrink-0" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 justify-center">
          <span id={titleId} className="window-title-text pixel truncate text-[0.5rem] uppercase">
            {title}
          </span>
        </span>
        <span className="title-box shrink-0" aria-hidden />
      </div>
      {stripe && <div className="stripe" aria-hidden />}
    </>
  )
}

interface WindowProps {
  title: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  stripe?: boolean
  /** Staggers the open animation, so a page of windows draws in sequence. */
  order?: number
  onClose?: () => void
  closeLabel?: string
}

/**
 * An application window: hard border, bevelled face, hard-edged shadow, and
 * a pinstriped title bar. Windows zoom open in five stepped frames, as they
 * did on the machines this imitates.
 */
export function Window({
  title,
  children,
  className,
  bodyClassName,
  stripe,
  order = 0,
  onClose,
  closeLabel,
}: WindowProps) {
  return (
    <section
      className={cn('window animate-window', className)}
      style={{ animationDelay: `${Math.min(order, 6) * 45}ms` }}
    >
      <TitleBar title={title} stripe={stripe} onClose={onClose} closeLabel={closeLabel} />
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
