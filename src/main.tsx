import { createRoot } from 'react-dom/client'
// HashRouter: the app must render at ANY path (Apps Script /exec sandbox, CDN subpath) — history routing goes blank…
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initTheme } from '@/stores/useThemeStore'
import { warmKept } from '@/lib/kept'
import { reloadForStaleChunk } from '@/lib/lazyPage'

initTheme()

// A STALE TAB SURVIVES A DEPLOY.
window.addEventListener('vite:preloadError', (event) => {
  // one guard for every lazy chunk (lib/lazyPage): a refused reload lets the error through to the screen
  if (reloadForStaleChunk()) event.preventDefault()
})

// THE KEPT COPIES ARE IN MEMORY BEFORE THE FIRST FRAME.
const KEPT_WARM_BOUND_MS = 600

const root = createRoot(document.getElementById('root')!)
let rendered = false
const render = () => {
  if (rendered) return
  rendered = true
  root.render(
    <HashRouter>
      <App />
    </HashRouter>,
  )
}
warmKept().then(render, render)
window.setTimeout(render, KEPT_WARM_BOUND_MS)
