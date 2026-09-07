import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/account'
import { useJson } from '@/lib/data'
import { PLATFORMS, PLATFORM_LABELS, type LatestFile, type Platform } from '@/lib/types'
import { Window } from '@/components/Window'

/**
 * A disk window: the platforms as icons you open, with the item count on a
 * status line above them. This is the folder-of-folders an operating system
 * would show, rather than a list of links.
 */
function DiskIcon({ platform }: { platform: Platform }) {
  const board = useJson<LatestFile>(`latest/${platform}.json`)
  const count = board.status === 'ready' ? board.data.games.length : null

  return (
    <Link
      to={`/p/${platform}`}
      className="group flex flex-col items-center gap-1.5 p-2 text-center"
    >
      {/* A 3.5-inch diskette, drawn rather than iconified. */}
      <span className="bevel flex size-12 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)] group-hover:bg-[var(--accent)]">
        <span className="flex size-full flex-col items-center justify-between p-1">
          <span className="h-3 w-5 border border-[var(--border)] bg-[var(--card)]" aria-hidden />
          <span className="h-3 w-8 border border-[var(--border)] bg-[var(--muted)]" aria-hidden />
        </span>
      </span>
      <span className="px-1 text-[0.7rem] font-semibold group-hover:bg-[var(--border)] group-hover:text-[var(--card)]">
        {PLATFORM_LABELS[platform]}
      </span>
      <span className="eyebrow">{count === null ? '—' : `${count} items`}</span>
    </Link>
  )
}

/** A folder, drawn like the diskette: the signed-in visitor's own shelves. */
function FolderIcon({ to, label, count }: { to: string; label: string; count: number | null }) {
  return (
    <Link to={to} className="group flex flex-col items-center gap-1.5 p-2 text-center">
      <span className="bevel flex size-12 items-center justify-center border-2 border-[var(--border)] bg-[var(--secondary)] group-hover:bg-[var(--accent)]">
        <span className="flex size-full flex-col p-1">
          <span className="h-2 w-4 border border-b-0 border-[var(--border)] bg-[var(--muted)]" aria-hidden />
          <span className="flex-1 border border-[var(--border)] bg-[var(--card)]" aria-hidden />
        </span>
      </span>
      <span className="px-1 text-[0.7rem] font-semibold group-hover:bg-[var(--border)] group-hover:text-[var(--card)]">
        {label}
      </span>
      <span className="eyebrow">{count === null ? '—' : `${count} items`}</span>
    </Link>
  )
}

export function DiskWindow({ order }: { order?: number }) {
  const meta = useJson<{ counts: { tracked: number } }>('meta.json')
  const tracked = meta.status === 'ready' ? meta.data.counts.tracked : null
  const account = useAccount()

  return (
    <Window title="RetroHeat HD" bodyClassName="p-0" order={order}>
      {/* Finder put the disk's contents summary on a line of its own. */}
      <div className="bevel-in flex items-center justify-between gap-3 border-b-2 border-[var(--border)] px-3 py-1.5">
        <span className="eyebrow">{PLATFORMS.length} items</span>
        <span className="eyebrow">{tracked === null ? '—' : `${tracked} games on disk`}</span>
      </div>

      <div className="grid grid-cols-3 gap-1 p-3 sm:grid-cols-6">
        {PLATFORMS.map((p) => (
          <DiskIcon key={p} platform={p} />
        ))}
      </div>

      {account.status === 'signed-in' && (
        <div className="grid grid-cols-3 gap-1 border-t-2 border-[var(--border)] p-3 sm:grid-cols-6">
          <FolderIcon
            to="/saved"
            label="Saved"
            count={account.saved.status === 'ready' ? account.saved.data.size : null}
          />
          <FolderIcon
            to="/collection"
            label="Collection"
            count={account.collection.status === 'ready' ? account.collection.data.size : null}
          />
        </div>
      )}
    </Window>
  )
}
