import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PLATFORMS } from '../lib/types'
import { ConsoleIcon, CONSOLE_SHAPES } from './ConsoleIcon'

describe('console icons', () => {
  it('draws every platform, and no platform that is not tracked', () => {
    expect(Object.keys(CONSOLE_SHAPES).sort()).toEqual([...PLATFORMS].sort())
    for (const platform of PLATFORMS) {
      const { container, unmount } = render(<ConsoleIcon platform={platform} />)
      expect(container.querySelector('svg')?.children.length, platform).toBeGreaterThan(0)
      unmount()
    }
  })

  // They sit in a column of lucide icons, so they are drawn the way lucide
  // draws: a 24-unit grid, a 2-unit stroke in the text colour, no fill.
  it('is drawn on the same grid and stroke as the lucide icons beside it', () => {
    for (const platform of PLATFORMS) {
      const { container, unmount } = render(<ConsoleIcon platform={platform} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('viewBox'), platform).toBe('0 0 24 24')
      expect(svg.getAttribute('fill'), platform).toBe('none')
      expect(svg.getAttribute('stroke'), platform).toBe('currentColor')
      expect(svg.getAttribute('stroke-width'), platform).toBe('2')
      expect(svg.getAttribute('aria-hidden'), platform).toBe('true')
      expect(svg.innerHTML, platform).not.toMatch(/fill=|stroke=|style=|#[0-9a-f]{3}/i)
      unmount()
    }
  })
})
