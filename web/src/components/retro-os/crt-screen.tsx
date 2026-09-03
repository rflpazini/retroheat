import { cn } from '@/lib/utils'

interface CRTScreenProps {
  /** The picture on the tube. Shown whole, letterboxed on a glow of itself. */
  src?: string
  alt?: string
  /** Shown in green phosphor when there is no picture. */
  children?: React.ReactNode
  /** The bezel. */
  className?: string
  /** The tube; override the aspect ratio here. */
  screenClassName?: string
}

/**
 * A picture behind CRT glass: the whole image, letterboxed on a tube that
 * glows with the image's own colours, under scanlines, an aperture grille
 * and curved-glass shading. Without a picture the screen shows whatever
 * children you pass as a phosphor message, so an empty state still looks
 * like hardware.
 */
export function CRTScreen({ src, alt = '', children, className, screenClassName }: CRTScreenProps) {
  return (
    <div className={cn('bevel self-start border-2 border-[var(--border)] bg-[var(--secondary)] p-2', className)}>
      <div className={cn('crt aspect-[4/3] w-full', screenClassName)}>
        {src ? (
          <>
            {/* The same picture blown up and blurred fills the tube behind
                the art, so the letterbox glows instead of sitting in black. */}
            <img className="crt-bleed" src={src} alt="" aria-hidden loading="lazy" />
            <img className="crt-art" src={src} alt={alt} loading="lazy" />
          </>
        ) : (
          <div className="crt-content font-[family-name:var(--font-mono)] text-[0.7rem]">{children}</div>
        )}
      </div>
    </div>
  )
}
