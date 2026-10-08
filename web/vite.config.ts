import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
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

/*
  The site as an installable, offline price guide. The shell (scripts, styles,
  fonts, icons) is precached on install; the data files are cached as they
  are seen, network first with a short timeout so a fresh price wins when
  there is a signal and the last one shows when there is not. Updates wait
  for the visitor ("prompt") and are announced on the status strip; the
  scope and start URL follow `base`, so the same config serves / locally and
  /retroheat/ on Pages.
*/
function offlineGuide(): Plugin[] {
  return VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: {
      name: 'RetroHeat',
      short_name: 'RetroHeat',
      description: 'What retro games are heating up: asking prices, movers and your own shelf, with or without a signal.',
      display: 'standalone',
      background_color: '#1f4e4c',
      theme_color: '#1f4e4c',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      // A long press on the home-screen icon goes straight to the camera.
      shortcuts: [
        {
          name: 'Scan a game',
          short_name: 'Scan',
          description: 'Scan the barcode on a box to add it to your collection',
          url: './#/collection?scan=1',
          icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
      runtimeCaching: [
        {
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/data/'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'retroheat-data',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 3600 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // The barcode reader for browsers without their own (Safari on an
          // iPhone): about a megabyte, so it is not precached for everyone,
          // only kept once a scan has fetched it. Its name carries a hash,
          // so a new build is a new entry and the old one ages out.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.wasm'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'retroheat-scanner',
            expiration: { maxEntries: 4 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    devOptions: { enabled: false },
  })
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // HTTPS=1 serves the dev site over https with a throwaway certificate, so
  // a phone on the same network (vite --host) may open the camera, which
  // browsers only allow on a secure page.
  plugins: [react(), tailwindcss(), serveCollectorData(), ...offlineGuide(), ...(process.env.HTTPS ? [basicSsl()] : [])],
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
