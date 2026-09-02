interface Props {
  title: string
  coverURL?: string
  platform: string
  year?: number
}

/**
 * Cover art behind CRT glass: the whole cover, letterboxed on a tube that
 * glows with the cover's own colours, under scanlines, an aperture grille and
 * curved-glass shading. When a release has no cover on file the screen shows
 * a phosphor boot message instead of an empty box, which is honest about the
 * missing data and still looks like hardware.
 */
export function CRTScreen({ title, coverURL, platform, year }: Props) {
  return (
    <div className="bevel border-2 border-[var(--border)] bg-[var(--secondary)] p-2">
      <div className="crt aspect-[4/3] w-full">
        {coverURL ? (
          <>
            {/* The same art blown up and blurred fills the tube behind the
                cover, so the letterbox glows with the cover's own colours
                instead of sitting in black bars. */}
            <img className="crt-bleed" src={coverURL} alt="" aria-hidden loading="lazy" />
            <img className="crt-art" src={coverURL} alt={`${title} cover art`} loading="lazy" />
          </>
        ) : (
          <div className="crt-content font-[family-name:var(--font-mono)] text-[0.7rem]">
            <p className="opacity-70">{platform.toUpperCase()}</p>
            <p className="text-[0.85rem] leading-snug font-semibold">{title}</p>
            {year ? <p className="opacity-70">© {year}</p> : null}
            <p className="opacity-70">
              NO COVER ON FILE<span className="blink">_</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
