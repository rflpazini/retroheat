/**
 * Derives the shadcn registry's theme item from src/index.css, so the site
 * and the registry are one set of rules. The stylesheet is the source; this
 * file only reads it.
 */

export type CSSTree = { [key: string]: string | CSSTree }

/** The comment that opens the shared section of index.css. */
export const MARKER = 'Everything below is the RetroOS look'

/** Variables that describe RetroHeat's data rather than the look. */
const APP_ONLY = /^(heat|cond)-/

/** Custom colours exposed to Tailwind as utilities (bg-titlebar and so on). */
export const THEME_COLORS = [
  'desktop',
  'desktop-grid',
  'titlebar',
  'titlebar-foreground',
  'menubar',
  'bevel-light',
  'bevel-dark',
  'stripe-1',
  'stripe-2',
  'stripe-3',
  'stripe-4',
  'stripe-5',
]

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * parseBlocks turns CSS into nested objects: rule and at-rule preludes become
 * keys whose value is the block, declarations become key/value strings.
 * Enough for this stylesheet, which has no strings containing braces or
 * semicolons.
 */
export function parseBlocks(css: string): CSSTree {
  const src = stripComments(css)
  let i = 0

  function block(): CSSTree {
    const out: CSSTree = {}
    let buf = ''
    const flush = () => {
      const t = buf.trim()
      buf = ''
      if (!t) return
      // Blockless at-rules such as @import and @custom-variant carry nothing
      // the registry needs.
      if (t.startsWith('@')) return
      const k = t.indexOf(':')
      if (k < 0) throw new Error(`declaration without a colon: ${t}`)
      out[tidy(t.slice(0, k))] = tidy(t.slice(k + 1))
    }
    while (i < src.length) {
      const ch = src[i]
      if (ch === '{') {
        const key = tidy(buf)
        buf = ''
        i++
        out[key] = block()
        continue
      }
      if (ch === '}') {
        flush()
        i++
        return out
      }
      if (ch === ';') {
        flush()
        i++
        continue
      }
      buf += ch
      i++
    }
    flush()
    return out
  }

  return block()
}

function vars(tree: CSSTree, selector: string): Record<string, string> {
  const blockTree = tree[selector]
  if (!blockTree || typeof blockTree === 'string') throw new Error(`no ${selector} block in index.css`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(blockTree)) {
    if (!k.startsWith('--') || typeof v !== 'string') continue
    const name = k.slice(2)
    if (APP_ONLY.test(name)) continue
    out[name] = v
  }
  return out
}

export interface ThemeItemFields {
  cssVars: { theme: Record<string, string>; light: Record<string, string>; dark: Record<string, string> }
  css: CSSTree
}

/** themeFromIndexCSS builds the registry theme item's cssVars and css. */
export function themeFromIndexCSS(indexCSS: string): ThemeItemFields {
  const found = indexCSS.indexOf(MARKER)
  if (found < 0) throw new Error(`index.css is missing the "${MARKER}" marker`)
  // The marker is inside a comment; split at that comment's opening.
  const at = indexCSS.lastIndexOf('/*', found)

  const head = parseBlocks(indexCSS.slice(0, at))
  const theme: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars(head, '@theme inline'))) theme[k] = v
  for (const c of THEME_COLORS) theme[`color-${c}`] = `var(--${c})`

  return {
    cssVars: { theme, light: vars(head, ':root'), dark: vars(head, '.dark') },
    css: parseBlocks(indexCSS.slice(at)),
  }
}
