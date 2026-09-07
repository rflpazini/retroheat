import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '../data')

// In development the collector output is a sibling directory rather than part
// of the build, so serve it at the same /data path the deployed site uses.
function serveCollectorData(): Plugin {
  return {
    name: 'retroheat-serve-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url?.startsWith('/data/')) return next()

        const target = path.join(dataDir, url.slice('/data/'.length))
        // A prefix check would also accept a sibling directory whose name
        // merely starts with "data", so compare on path boundaries instead.
        const rel = path.relative(dataDir, target)
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          res.statusCode = 403
          return res.end('forbidden')
        }
        fs.readFile(target, (err, body) => {
          if (err) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            return res.end('{"error":"not found"}')
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(body)
        })
      })
    },
  }
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), serveCollectorData()],
  resolve: {
    alias: { '@': path.resolve(here, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Accounts stay off under test whatever a developer's web/.env says; the
    // account tests inject an in-memory backend instead.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
})
