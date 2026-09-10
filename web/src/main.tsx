import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { reloadForNewVersion } from './lib/lazy'
import './index.css'

// Vite reports a chunk it could not preload here; a tab that outlived a
// deploy reloads once to get the new file names. The error is left to
// propagate (preventDefault would make the import resolve to nothing), so
// the route's error window can name it while the reload is under way.
window.addEventListener('vite:preloadError', () => {
  reloadForNewVersion()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
