import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/aileron/400.css'
import '@fontsource/aileron/600.css'
import '@fontsource/aileron/700.css'
import '@fontsource/aileron/800.css'
import './index.css'
import './voice/voice.css'
import { configureAudio } from './audio/toneContext'
import App from './App.tsx'
import Landing from './landing/Landing.tsx'
import TestPage from './test/TestPage.tsx'
import { HELP_APP, HELP_LANDING } from './voice/commands'
import { VoiceProvider, type FallbackHandler } from './voice/VoiceProvider'
import { VoiceButton } from './voice/VoiceButton'

// "/" → landing · "/symphony" → la app · "/test" → prueba de voz. Los enlaces viejos (/jukebox, ?pista, ?debug) siguen abriendo la app.
function isAppUrl(url: string) {
  const u = new URL(url, window.location.origin)
  return ['/symphony', '/jukebox'].some((p) => u.pathname.startsWith(p)) || u.searchParams.has('pista') || u.searchParams.has('debug')
}

const TITLES: Record<string, string> = { incendio: 'the Dixie Fire', rayos: 'the storms of the planet' }

/**
 * Cambia de página sin recargar: así el micrófono sigue escuchando y el navegador recuerda que
 * ya hubo un clic (sin eso, no deja arrancar el sonido después de un comando de voz).
 */
function Root() {
  const [url, setUrl] = useState(() => window.location.pathname + window.location.search)
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to)
    setUrl(to)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    const onPop = () => setUrl(window.location.pathname + window.location.search)
    window.addEventListener('popstate', onPop)
    // Enlaces internos (<a href="/symphony…">): se abren sin recargar la página.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a')
      const href = a?.getAttribute('href')
      if (!a || !href || a.target || a.hasAttribute('download') || !href.startsWith('/') || href.startsWith('//')) return
      e.preventDefault()
      navigate(href)
    }
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('click', onClick)
    }
  }, [navigate])

  const showApp = isAppUrl(url)
  const showTest = new URL(url, window.location.origin).pathname.startsWith('/test')

  // Lo que la página activa no atiende: navegar entre páginas y la ayuda general.
  const fallback = useCallback<FallbackHandler>((cmd, { setPending }) => {
    switch (cmd.type) {
      case 'goto':
        if (cmd.target === 'inicio') {
          if (!showApp) return 'You are already on the home page.'
          navigate('/')
          return 'Home page. Say: start the tour, or what can I say.'
        }
        navigate(`/symphony?pista=${cmd.target}`)
        return `Opening ${TITLES[cmd.target]}. Say play to listen.`
      case 'play':
      case 'resume':
        if (showApp) return null
        // Dicho en la página de inicio: abre las tormentas y empieza a sonar.
        setPending({ type: 'play' })
        navigate('/symphony?pista=rayos')
        return 'Opening the storms of the planet.'
      case 'help':
        return showApp ? HELP_APP : HELP_LANDING
      default:
        return showApp ? null : 'That works inside the simulation. Say: take me to the storms, or take me to the fire.'
    }
  }, [showApp, navigate])

  // /test: prueba de voz, sin los comandos activos (solo muestra lo que se oye).
  if (showTest) return <TestPage />

  return (
    <VoiceProvider onFallback={fallback}>
      {showApp ? <App key="app" /> : <Landing key="landing" />}
      {!showApp && <VoiceButton variant="floating" />}
    </VoiceProvider>
  )
}

// Antes de crear cualquier sintetizador: búferes de audio más grandes (sin chasquidos).
configureAudio()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
