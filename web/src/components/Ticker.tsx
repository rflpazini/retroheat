import { useJson } from '@/lib/data'
import { heat, money, pct } from '@/lib/format'
import { CONDITION_LABELS, PLATFORM_SHORT, type TrendingFile } from '@/lib/types'

/**
 * A scrolling band of the day's biggest movers. It duplicates its contents so
 * the loop is seamless, pauses on hover, and is hidden from screen readers
 * because the same games are listed properly on the board below.
 */
export function Ticker() {
  const board = useJson<TrendingFile>('trending/all.json')
  if (board.status !== 'ready' || board.data.entries.length === 0) return null

  const entries = board.data.entries.slice(0, 12)

  return (
    <div
      className="ticker window overflow-hidden py-1.5"
      aria-hidden
    >
      <div className="ticker-track flex w-max gap-8 whitespace-nowrap">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-8">
            {entries.map((e) => {
              // The week's move when there is one; in the first week of
              // collection only the day's move exists, and a dash says nothing.
              const move = e.pct_7d ?? e.pct_1d
              return (
                <span key={`${copy}-${e.id}`} className="flex items-center gap-2 text-[0.7rem]">
                  <span className="eyebrow">{PLATFORM_SHORT[e.platform]}</span>
                  <span className="font-semibold">{e.title}</span>
                  <span className="tabular">{money(e.price_cents)}</span>
                  <span className="eyebrow">{CONDITION_LABELS[e.headline_condition]}</span>
                  <span className="tabular font-bold" style={{ color: heat(move) }}>
                    {pct(move)}
                  </span>
                  <span className="opacity-40">◆</span>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
