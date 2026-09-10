import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { RouteError } from './RouteError'

function Throws({ error }: { error: Error }): never {
  throw error
}

function renderFailing(error: Error) {
  const router = createMemoryRouter(
    [{ path: '/', element: <Throws error={error} />, errorElement: <RouteError /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('the route error window', () => {
  it('tells a tab that outlived a deploy to reload, in plain words', () => {
    renderFailing(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Saved-D6ELg5ms.js'))
    expect(document.body.textContent).toMatch(/this page needs the new version/i)
    expect(document.body.textContent).toMatch(/updated while this tab was open/i)
    expect(screen.getByRole('button', { name: /reload/i })).toBeDefined()
    expect(screen.getByRole('link', { name: /back to the boards/i })).toBeDefined()
    expect(document.body.textContent).not.toMatch(/unexpected application error/i)
  })

  it('names any other failure instead of hiding it', () => {
    renderFailing(new Error('the chart had no data'))
    expect(document.body.textContent).toMatch(/this page could not be opened/i)
    expect(document.body.textContent).toMatch(/the chart had no data/i)
  })
})
