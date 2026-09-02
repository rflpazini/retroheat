import { useJson } from '@/lib/data'
import { formatDate } from '@/lib/format'
import type { Meta } from '@/lib/types'
import { Window } from '@/components/Window'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Window title={title}>
      <div className="space-y-3 text-xs leading-relaxed">{children}</div>
    </Window>
  )
}

export function About() {
  const meta = useJson<Meta>('meta.json')

  return (
    <div className="max-w-3xl space-y-4">
      <Window title="Readme.txt" stripe>
        <p className="text-xs leading-relaxed">
        RetroHeat tracks a curated list of collectible games for six legacy consoles and ranks them
          by how fast their prices are moving. Everything is open source and rebuilt twice a day.
        </p>
      </Window>

      <Section title="Where the numbers come from">
        <p>
          Each tracked game gets one eBay Browse API search per run. Listings are sorted into loose,
          complete-in-box and sealed; obvious non-games are discarded (empty cases, reproductions,
          lots, strategy guides, graded slabs); and the rest are reduced, after an interquartile
          trim, to a median and a mode: the middle asking price, and the whole-dollar point most
          sellers cluster on. A single fantasy price cannot move either figure.
        </p>
        <p className="font-semibold">
          These are <strong className="font-semibold">asking prices on active listings</strong>, not
          realized sale prices. eBay retired public access to sold-listing data, so no free source of
          true sale prices exists. Asking prices sit above sale prices; the direction they move is
          meaningful, the absolute number is not an appraisal.
        </p>
      </Section>

      <Section title="How trending is ranked">
        <p>
          Daily prices are smoothed with a five-point rolling median, which removes one-day spikes
          without flattening real moves. A game's score is 0.6 × its 7-day change plus 0.4 × its
          30-day change, measured on its complete-in-box price where one exists and its loose price
          otherwise.
        </p>
        <p>
          Two gates keep the boards honest: a game must be worth at least $10, because a few dollars
          of noise on a bargain-bin title reads as a huge percentage, and it needs at least four
          listings behind its price. Ranking by percentage rather than dollars surfaces the $40 game
          becoming a $60 game instead of repeating the same expensive titles every week.
        </p>
      </Section>

      <Section title="What is tracked">
        <p>
          A hand-curated catalog rather than every game ever released, because momentum is only
          meaningful for titles collectors actually trade. Print variants are tracked separately
          where they price differently, such as a PS2 black label against its Greatest Hits reprint.
        </p>
        <p>
          Adding a game is a pull request against one YAML file. So is adding the context note
          explaining why something is moving, which is the part no price site bothers with.
        </p>
      </Section>

      <Section title="Limits worth knowing">
        <p>
          Listings are US-only and priced in dollars. A game with few listings will look noisy.
          Regional releases, promo discs and graded copies are out of scope for now. When a run
          cannot price a game, its previous figure is kept and flagged as stale rather than dropped.
        </p>
      </Section>

      {meta.status === 'ready' && (
        <Section title="Last run">
          <div className="flex flex-wrap gap-2">
            {[
              `Generated ${formatDate(meta.data.generated_at)}`,
              `${meta.data.counts.ok} priced`,
              `${meta.data.counts.stale} stale`,
              `${meta.data.counts.failed} failed`,
              `${meta.data.counts.tracked} tracked`,
              `Source: ${meta.data.source}`,
              `${meta.data.api_calls_used} API calls`,
            ].map((chip) => (
              <span
                key={chip}
                className="bevel border-2 border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-[0.6rem]"
              >
                {chip}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
