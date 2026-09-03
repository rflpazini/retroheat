import { CRTScreen as Tube } from '@/components/retro-os/crt-screen'

interface Props {
  title: string
  coverURL?: string
  platform: string
  year?: number
}

/**
 * Cover art behind CRT glass. When a release has no cover on file the screen
 * shows a phosphor boot message instead of an empty box, which is honest
 * about the missing data and still looks like hardware.
 */
export function CRTScreen({ title, coverURL, platform, year }: Props) {
  return (
    <Tube src={coverURL} alt={`${title} cover art`}>
      <p className="opacity-70">{platform.toUpperCase()}</p>
      <p className="text-[0.85rem] leading-snug font-semibold">{title}</p>
      {year ? <p className="opacity-70">© {year}</p> : null}
      <p className="opacity-70">
        NO COVER ON FILE<span className="blink">_</span>
      </p>
    </Tube>
  )
}
