import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseBlocks, themeFromIndexCSS } from './registry-css'

const web = path.resolve(__dirname, '../..')
const registry = JSON.parse(fs.readFileSync(path.join(web, 'registry.json'), 'utf8')) as {
  homepage: string
  items: {
    name: string
    type: string
    files?: { path: string; type: string; target?: string }[]
    registryDependencies?: string[]
    cssVars?: unknown
    css?: unknown
  }[]
}
const indexCSS = fs.readFileSync(path.join(web, 'src/index.css'), 'utf8')

describe('parseBlocks', () => {
  it('nests rules and keeps declarations as strings', () => {
    expect(
      parseBlocks(`
        /* comment */
        @utility crt { position: relative; & > .art { width: 100%; } &::before { content: ''; } }
        @keyframes blink { 0%, 49% { opacity: 1; } }
      `),
    ).toEqual({
      '@utility crt': { position: 'relative', '& > .art': { width: '100%' }, '&::before': { content: "''" } },
      '@keyframes blink': { '0%, 49%': { opacity: '1' } },
    })
  })
})

describe('registry.json', () => {
  const theme = registry.items.find((i) => i.type === 'registry:theme')!
  const themeURL = `${registry.homepage}/r/${theme.name}.json`

  it('carries the theme derived from index.css, so the site and the registry agree', () => {
    // Run `npm run registry` after editing the shared section of index.css.
    const expected = themeFromIndexCSS(indexCSS)
    expect(theme.cssVars).toEqual(expected.cssVars)
    expect(theme.css).toEqual(expected.css)
  })

  it('exposes the palette and the chrome utilities', () => {
    const { cssVars, css } = themeFromIndexCSS(indexCSS)
    for (const key of ['card', 'border', 'titlebar', 'menubar', 'bevel-light', 'bevel-dark', 'stripe-1', 'radius']) {
      expect(cssVars.light, key).toHaveProperty(key)
    }
    // Night mode overrides the surfaces; the stripe and radius are inherited.
    for (const key of ['card', 'border', 'titlebar', 'menubar', 'bevel-light', 'bevel-dark', 'desktop']) {
      expect(cssVars.dark, key).toHaveProperty(key)
    }
    for (const key of Object.keys(cssVars.dark)) expect(cssVars.light, key).toHaveProperty(key)
    // Data semantics stay in the app.
    expect(Object.keys(cssVars.light).some((k) => /^(heat|cond)-/.test(k))).toBe(false)
    for (const u of ['window', 'window-title', 'bevel', 'bevel-in', 'press', 'pixel', 'eyebrow', 'stripe', 'crt']) {
      expect(css, u).toHaveProperty(`@utility ${u}`)
    }
    expect(cssVars.theme).toHaveProperty('font-pixel')
    expect(cssVars.theme['color-titlebar']).toBe('var(--titlebar)')
  })

  it('names every item once and points each file at a real source', () => {
    const names = registry.items.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
    for (const item of registry.items) {
      for (const f of item.files ?? []) {
        expect(fs.existsSync(path.join(web, f.path)), f.path).toBe(true)
        expect(f.target, f.path).toMatch(/^@components\/retro-os\//)
      }
    }
  })

  it('makes every component pull the theme in with it', () => {
    for (const item of registry.items.filter((i) => i.type === 'registry:component')) {
      expect(item.registryDependencies, item.name).toContain(themeURL)
    }
    const kit = registry.items.find((i) => i.name === 'retro-os-kit')!
    for (const item of registry.items.filter((i) => i.type === 'registry:component')) {
      expect(kit.registryDependencies).toContain(`${registry.homepage}/r/${item.name}.json`)
    }
  })

  it('has no registry component importing another registry component by path', () => {
    // Each item must stand alone once installed, whatever alias the consumer uses.
    for (const item of registry.items) {
      for (const f of item.files ?? []) {
        const src = fs.readFileSync(path.join(web, f.path), 'utf8')
        expect(src, f.path).not.toMatch(/@\/components\/retro-os\//)
        expect(src, f.path).not.toMatch(/@\/lib\/(?!utils)/)
      }
    }
  })
})
