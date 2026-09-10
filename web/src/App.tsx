import { lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RouteError } from '@/components/RouteError'
import { Home } from '@/pages/Home'
import { Platform } from '@/pages/Platform'
import { About } from '@/pages/About'
import { Message } from '@/components/States'
import { Skeleton } from '@/components/ui/skeleton'
import { importFresh } from '@/lib/lazy'

// The charting library is only needed on a game page, so it stays out of the
// bundle the boards load with. importFresh reloads the page once when a
// deploy has replaced the chunk a stale tab asks for.
const Game = lazy(() => importFresh(() => import('@/pages/Game')).then((m) => ({ default: m.Game })))
// The shelf pages are only reachable with accounts on, so they load on demand too.
const Saved = lazy(() => importFresh(() => import('@/pages/Saved')).then((m) => ({ default: m.Saved })))
const Collection = lazy(() =>
  importFresh(() => import('@/pages/Collection')).then((m) => ({ default: m.Collection })),
)

// Hash routing keeps GitHub Pages serving a single index.html without the
// 404.html redirect trick. The error window sits on the child routes so the
// desktop chrome stays up around it.
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: 'p/:platform', element: <Platform /> },
      {
        path: 'g/:id',
        element: (
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
            <Game />
          </Suspense>
        ),
      },
      {
        path: 'saved',
        element: (
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
            <Saved />
          </Suspense>
        ),
      },
      {
        path: 'collection',
        element: (
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
            <Collection />
          </Suspense>
        ),
      },
      { path: 'about', element: <About /> },
      {
        path: '*',
        element: <Message title="Page not found" detail="Use the navigation to pick a board." />,
      },
    ].map((route) => ({ ...route, errorElement: <RouteError /> })),
  },
])

export function App() {
  return <RouterProvider router={router} />
}
