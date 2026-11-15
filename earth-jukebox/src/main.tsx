import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/aileron/400.css'
import '@fontsource/aileron/600.css'
import '@fontsource/aileron/700.css'
import '@fontsource/aileron/800.css'
import './index.css'
import App from './App.tsx'
import Landing from './landing/Landing.tsx'

// "/" → landing · "/symphony" → la app. Los enlaces viejos (/jukebox, ?pista, ?debug) siguen abriendo la app.
const params = new URLSearchParams(window.location.search)
const showApp = ['/symphony', '/jukebox'].some((p) => window.location.pathname.startsWith(p)) || params.has('pista') || params.has('debug')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showApp ? <App /> : <Landing />}
  </StrictMode>,
)
