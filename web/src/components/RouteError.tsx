import { Link, useRouteError } from 'react-router-dom'
import { isStaleChunkError } from '@/lib/lazy'
import { shelfButton } from '@/components/ShelfControls'
import { Message } from '@/components/States'

/**
 * What a route shows when it cannot render. The common case is a tab that
 * outlived a deploy and asked for a chunk that no longer exists; that gets
 * a plain explanation and a Reload button. Anything else says what broke.
 */
export function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'

  return (
    <Message
      title={stale ? 'This page needs the new version' : 'This page could not be opened'}
      detail={
        stale
          ? 'RetroHeat was updated while this tab was open, so part of it could not be loaded. Reload to pick up the new version.'
          : `Something went wrong while drawing it: ${reason}`
      }
      action={
        <span className="flex flex-wrap items-center gap-3">
          <button type="button" className={shelfButton} onClick={() => window.location.reload()}>
            Reload
          </button>
          <Link to="/" className="text-xs underline">
            Back to the boards
          </Link>
        </span>
      }
    />
  )
}
