import { cn } from '@/lib/utils'

interface Props {
  title: string
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  stripe?: boolean
  /** Staggers the open animation, so a page of windows draws in sequence. */
  order?: number
}

/**
 * An application window in the System 7 idiom: pinstriped title bar with the
 * title punched out of it, a close box on the left and a zoom box on the
 * right. Both boxes are scenery, so they are hidden from assistive technology
 * and are not focusable; the heading text carries the meaning.
 */
export function Window({ title, children, className, bodyClassName, stripe, order = 0 }: Props) {
  return (
    <section
      className={cn('window animate-window', className)}
      style={{ animationDelay: `${Math.min(order, 6) * 45}ms` }}
    >
      <div className="window-title flex items-center gap-2 px-2 py-1">
        <span className="title-box shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 justify-center">
          <span className="window-title-text pixel truncate text-[0.5rem] uppercase">{title}</span>
        </span>
        <span className="title-box shrink-0" aria-hidden />
      </div>
      {stripe && <div className="stripe" aria-hidden />}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
