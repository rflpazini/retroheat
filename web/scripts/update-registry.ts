// Refreshes the theme item in registry.json from src/index.css. Run through
// `npm run registry`; the registry test fails when the two disagree.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { themeFromIndexCSS } from '../src/lib/registry-css.ts'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registryPath = path.join(web, 'registry.json')

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  items: ({ name: string; type: string } & Record<string, unknown>)[]
}
const theme = registry.items.find((i) => i.type === 'registry:theme')
if (!theme) throw new Error('registry.json has no registry:theme item')

const fields = themeFromIndexCSS(fs.readFileSync(path.join(web, 'src/index.css'), 'utf8'))
theme.cssVars = fields.cssVars
theme.css = fields.css

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n')
console.log(`registry.json: theme "${theme.name}" refreshed from src/index.css`)
