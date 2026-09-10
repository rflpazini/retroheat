import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { reloadForNewVersion } from './lib/lazy'
import './index.css'

// Vite reports a chunk it could not preload here; a tab that outlived a
// deploy reloads once to get the new file names, otherwise the error goes on
// to the route's error window.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
