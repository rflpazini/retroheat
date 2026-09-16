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
  /**
   * Take the height the parent offers instead of the height of the content,
   * so a WindowPane inside scrolls and the page does not. Only from the
   * large breakpoint, where the desktop is one screen; on a phone the page
   * flows as usual.
   */
  fill?: boolean
}

/*
  The classes that let a flex column hand its spare height down to a child.
  The window keeps a floor of its own: below it the page scrolls instead,
  because a window that shrank further would draw its border across its own
  rows. Everything inside may shrink to nothing, so the pane gets the rest.
*/
const fillWindow = 'lg:flex lg:min-h-[20rem] lg:flex-1 lg:flex-col'
const fillBody = 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'

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
  fill,
}: WindowProps) {
  return (
    <section
      className={cn('window animate-window', fill && fillWindow, className)}
      style={{ animationDelay: `${Math.min(order, 6) * 45}ms` }}
    >
      <TitleBar title={title} stripe={stripe} onClose={onClose} closeLabel={closeLabel} />
      <div className={cn('p-4', fill && fillBody, bodyClassName)}>{children}</div>
    </section>
  )
}

interface WindowPaneProps {
  /** What is being scrolled, read out to a keyboard or screen-reader user who lands on the pane. */
  label: string
  children: React.ReactNode
  className?: string
}

/**
 * The scrolling part of a window. A System 7 list scrolled inside its own
 * frame, behind a scroll bar of arrow boxes and a dotted track, while the
 * desktop stayed put; this is that frame. It is a focusable region, because a
 * scroll bar you cannot reach from the keyboard is scenery, not a control.
 */
export function WindowPane({ label, children, className }: WindowPaneProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn('pane lg:min-h-0 lg:flex-1 lg:[scrollbar-gutter:stable]', className)}
    >
      {children}
    </div>
  )
}
