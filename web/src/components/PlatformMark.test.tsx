import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { resetCache } from '../lib/data'
import { PLATFORMS, PLATFORM_LABELS } from '../lib/types'
import { Platform } from '../pages/Platform'
import { PlatformMark } from './PlatformMark'
import { PLATFORM_MARKS } from './platform-marks'

describe('platform marks', () => {
  it('draws every platform and names it by its label', () => {
    for (const platform of PLATFORMS) {
      const { unmount } = render(<PlatformMark platform={platform} />)
      const mark = screen.getByRole('img', { name: PLATFORM_LABELS[platform] })
      expect(mark.querySelector('path')?.getAttribute('d'), platform).toMatch(/^M/i)
      unmount()
    }
    // The type already demands a mark per platform; this catches a stray one left behind.
    expect(Object.keys(PLATFORM_MARKS).sort()).toEqual([...PLATFORMS].sort())
  })

  it('is one path in the ink of its surroundings, with no colour of its own', () => {
    for (const platform of PLATFORMS) {
      const { container, unmount } = render(<PlatformMark platform={platform} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('fill'), platform).toBe('currentColor')
      expect(svg.children, platform).toHaveLength(1)
      expect(svg.innerHTML, platform).not.toMatch(/fill=|stroke|style=|gradient|#[0-9a-f]{3}/i)
      unmount()
    }
  })

  it('keeps every mark on a grid of the same area, so they share one optical size', () => {
    for (const platform of PLATFORMS) {
      const { w, h } = PLATFORM_MARKS[platform]
      expect(Math.sqrt(w * h), platform).toBeGreaterThan(275)
      expect(Math.sqrt(w * h), platform).toBeLessThan(285)
    }
  })

  it('steps aside for assistive technology when the name is already beside it', () => {
    const { container } = render(<PlatformMark platform="n64" decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('stays out of the published registry, which other projects install', () => {
    const web = path.resolve(__dirname, '../..')
    expect(fs.readFileSync(path.join(web, 'registry.json'), 'utf8')).not.toMatch(/platform-?marks?/i)
    const published = path.join(web, 'src/components/retro-os')
    for (const file of fs.readdirSync(published)) {
      expect(fs.readFileSync(path.join(published, file), 'utf8'), file).not.toMatch(/platform-?marks?/i)
    }
  })
})

describe("a board carries its console's mark", () => {
  function renderBoard(platform: string) {
    return render(
      <MemoryRouter initialEntries={[`/p/${platform}`]}>
        <Routes>
          <Route path="/p/:platform" element={<Platform />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    resetCache()
  })

  it('in the header of a priced board', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          platform: 'n64',
          as_of: '2026-10-07',
          source: 'ebay-browse',
          price_kind: 'asking',
          games: [
            {
              id: 'x-n64', title: 'X', region: 'NTSC-U', variant: 'none', prices: { loose: { median_cents: 1000, n: 5 } },
              pct_1d: null, pct_7d: 2, pct_30d: null, sparks: {}, stale: false, as_of: '2026-10-07',
            },
          ],
        }),
        { status: 200 },
      ),
    )
    renderBoard('n64')

    const mark = await screen.findByRole('img', { name: 'Nintendo 64' })
    // Ahead of the summary line, in the strip above the table rather than in a row of it.
    expect(mark.parentElement?.textContent).toMatch(/1 games/)
    expect(mark.closest('table')).toBeNull()
  })

  it('beside the notice on a board the collector has not priced yet', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    const { container } = renderBoard('ps3')

    expect(await screen.findByText(/PlayStation 3 was added to the catalog/)).toBeDefined()
    // The sentence names the console, so the picture is not read out as well.
    expect(container.querySelector('svg[aria-hidden="true"] path')?.getAttribute('d')).toBe(PLATFORM_MARKS.ps3.d)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
