import { useEffect, useState } from 'react'
import { useVoice } from './VoiceProvider'

/** Íconos "mic" y "mic-off" de Lucide (lucide.dev, ISC). */
const MicIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19v3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <rect x="9" y="2" width="6" height="13" rx="3" />
  </svg>
)
const MicOffIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19v3" />
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
    <path d="M16.95 16.95A7 7 0 0 1 5 12v-2" />
    <path d="M18.89 13.23A7 7 0 0 0 19 12v-2" />
    <path d="m2 2 20 20" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
  </svg>
)

const LABEL: Record<string, string> = {
  unsupported: 'Voice unavailable',
  off: 'Turn on voice',
  loading: 'Loading voice…',
  starting: 'Starting…',
  listening: 'Listening',
  denied: 'Microphone blocked',
  error: 'Voice offline',
}
const HINT: Record<string, string> = {
  unsupported: 'This browser does not support speech recognition. Use Chrome or Edge.',
  denied: 'Allow the microphone from the lock icon in the address bar, then press again.',
  error: 'Could not connect to speech recognition. Press to try again.',
}

/** Botón para activar los comandos de voz, con lo último que se oyó y la respuesta. */
export function VoiceButton({ variant = 'inline' }: { variant?: 'inline' | 'floating' }) {
  const { status, heard, reply, toggle, activity, engine, chosen, setChosen, micLabel } = useVoice()
  const on = status === 'listening' || status === 'starting' || status === 'loading'
  const label =
    status === 'listening' && activity === 'speech' ? 'Hearing you…'
        : status === 'listening' && activity === 'processing' ? 'Processing…'
          : LABEL[status]
  const hint = HINT[status]
  // La burbuja con lo oído y la respuesta se ve unos segundos y se oculta sola.
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (!heard && !reply) return
    setFresh(true)
    const id = window.setTimeout(() => setFresh(false), 6000)
    return () => window.clearTimeout(id)
  }, [heard, reply])
  const showBubble = !!hint || (on && (fresh || !heard))
  return (
    <div className={`voice voice-${variant} ${on ? 'is-on' : ''}`}>
      <div className="voice-row">
      <div className="voice-engine" role="radiogroup" aria-label="Speech recognizer">
        <button type="button" role="radio" aria-checked={chosen === 'whisper'} onClick={() => setChosen('whisper')}
          title="Whisper large-v3 on OpenRouter: the most accurate, with noise filtering">Whisper large</button>
        <button type="button" role="radio" aria-checked={chosen === 'chrome'} onClick={() => setChosen('chrome')}
          title="Chrome speech recognition (Google)">Chrome</button>
      </div>
      <button
        type="button"
        className="voice-btn"
        onClick={toggle}
        aria-pressed={on}
        aria-keyshortcuts="V"
        aria-label={on ? 'Voice commands on. Press to turn off' : 'Turn on voice commands'}
        disabled={status === 'unsupported'}
      >
        <span className="voice-icon">{on ? MicIcon : MicOffIcon}</span>
        <span className="voice-label">{label}</span>
        {status === 'listening' && <span className={`voice-dot ${activity !== 'idle' ? 'is-active' : ''}`} aria-hidden="true" />}
      </button>
      </div>
      {status === 'listening' && (
        <p className="voice-mic">
          {engine === 'whisper' ? 'Whisper large' : 'Chrome'}
          {chosen !== engine && ' (fallback)'}
          {micLabel && <> · microphone: {micLabel}</>}
        </p>
      )}
      {showBubble && (
        <p className="voice-bubble" aria-hidden="true">
          {hint ?? (heard ? <><span className="voice-heard">“{heard}”</span>{reply && <span className="voice-reply">{reply}</span>}</> : <span className="voice-reply">Say: “What can I say?”</span>)}
        </p>
      )}
    </div>
  )
}
