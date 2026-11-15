/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { afterWakeWord, lastWords, parseCommand, type Command } from './commands'
import { isEcho, speak, stopSpeaking } from './speak'
import { defaultMicLabel, getRecognizer, saveRecognizer, WhisperListener, type Recognizer } from './whisperListener'

/**
 * Comandos de voz con el reconocimiento del navegador (Web Speech API, Chrome y Edge).
 * Escucha continuamente en español; cada frase reconocida se convierte en un comando y se
 * entrega a la página activa (la landing o la app). La respuesta se dice en voz alta.
 */

export type VoiceStatus = 'unsupported' | 'off' | 'loading' | 'starting' | 'listening' | 'denied' | 'error'
/** Reconocedor: Whisper large-v3 (OpenRouter) o el de Chrome (Google). Se elige en el botón de voz. */
export type VoiceEngine = Recognizer
/** Lo que hace la página con un comando: devuelve la frase a decir, o null si no lo atiende. */
export type VoiceHandler = (cmd: Command) => string | null | Promise<string | null>
/** Lo que no atiende la página (navegar, ayuda general…). Puede dejar un comando para la siguiente página. */
export type FallbackHandler = (cmd: Command, tools: { setPending: (c: Command | null) => void }) => string | null | Promise<string | null>

interface VoiceCtx {
  status: VoiceStatus
  /** Reconocedor que se está usando. */
  engine: VoiceEngine
  /** Reconocedor elegido (puede diferir de engine si Whisper falló y se usa Chrome de respaldo). */
  chosen: VoiceEngine
  setChosen: (e: VoiceEngine) => void
  /** Nombre del micrófono en uso. */
  micLabel: string
  /** Con Whisper: 'speech' mientras hablas, 'processing' mientras transcribe. */
  activity: 'idle' | 'speech' | 'processing'
  /** Modo ruido: solo obedece lo que va después de "Sinfonía". */
  noiseMode: boolean
  setNoiseMode: (on: boolean) => void
  heard: string
  reply: string
  toggle: () => void
  say: (text: string) => void
  setHandler: (h: VoiceHandler | null) => void
  /** Comando pendiente para la siguiente página (p. ej. "comienza" dicho en la landing). */
  setPending: (cmd: Command | null) => void
  takePending: () => Command | null
}

const Ctx = createContext<VoiceCtx | null>(null)

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function getRecognition(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const STORE_KEY = 'earth-symphony-voz'
const NOISE_KEY = 'earth-symphony-modo-ruido'
/** Un comando que se oye mientras se habla se ejecuta si no cambia en este tiempo (o al cerrar la frase). */
const STABLE_MS = 650
/** Cada cuánto se limpia lo acumulado si no se oyó ningún comando (con ruido, la frase nunca se cierra). */
const SESSION_MS = 12000
function remember(on: boolean) {
  try { localStorage.setItem(STORE_KEY, on ? '1' : '0') } catch { /* sin almacenamiento */ }
}
function remembered(): boolean {
  try { return localStorage.getItem(STORE_KEY) === '1' } catch { return false }
}

export function VoiceProvider({ children, onFallback }: { children: ReactNode; onFallback: FallbackHandler }) {
  const Ctor = useMemo(() => (typeof window === 'undefined' ? null : getRecognition()), [])
  const canWhisper = useMemo(
    () => typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    [],
  )
  const [status, setStatus] = useState<VoiceStatus>(Ctor || canWhisper ? 'off' : 'unsupported')
  const engineRef = useRef<VoiceEngine>(canWhisper && getRecognizer() === 'whisper' ? 'whisper' : 'chrome')
  const [engine, setEngineState] = useState<VoiceEngine>(engineRef.current)
  const [chosen, setChosenState] = useState<VoiceEngine>(engineRef.current)
  const [micLabel, setMicLabel] = useState('')
  const [activity, setActivity] = useState<'idle' | 'speech' | 'processing'>('idle')
  const whisper = useRef<WhisperListener | null>(null)
  const [heard, setHeard] = useState('')
  const [reply, setReply] = useState('')
  const rec = useRef<Recognition | null>(null)
  const wanted = useRef(false)
  const handler = useRef<VoiceHandler | null>(null)
  const fallback = useRef(onFallback)
  const pending = useRef<Command | null>(null)
  const lastMiss = useRef(0)
  const failures = useRef(0)
  useEffect(() => { fallback.current = onFallback }, [onFallback])

  const say = useCallback((text: string) => {
    setReply(text)
    speak(text)
  }, [])

  const [noiseMode, setNoiseState] = useState(() => {
    try { return localStorage.getItem(NOISE_KEY) === '1' } catch { return false }
  })
  const noise = useRef(noiseMode)
  const setNoiseMode = useCallback((on: boolean) => {
    noise.current = on
    setNoiseState(on)
    try { localStorage.setItem(NOISE_KEY, on ? '1' : '0') } catch { /* sin almacenamiento */ }
  }, [])

  // Sesión de escucha actual: al ejecutar un comando se abre otra, y lo que llegue de la anterior se descarta.
  const session = useRef(0)
  const candidate = useRef<{ key: string; cmd: Command; text: string; timer: number } | null>(null)

  const execute = useCallback(async (cmd: Command, text: string) => {
    setHeard(text)
    if (cmd.type === 'stopListening') {
      wanted.current = false
      remember(false)
      rec.current?.abort()
      whisper.current?.stop()
      setStatus('off')
      say('I stopped listening. To turn me back on, press the voice button or the V key.')
      return
    }
    if (cmd.type === 'noiseMode') {
      setNoiseMode(cmd.on)
      say(cmd.on
        ? 'Noise mode on. Now say Symphony before each command. For example: Symphony, pause.'
        : 'Normal mode. You no longer need to say Symphony.')
      return
    }
    const answer = (await handler.current?.(cmd)) ?? (await fallback.current(cmd, { setPending: (c) => { pending.current = c } }))
    if (answer) say(answer)
  }, [say, setNoiseMode])

  /**
   * Busca un comando en lo que se oyó. Solo mira las últimas palabras (con ruido, el navegador junta
   * todo lo que oye en una sola frase) y, en modo ruido, solo lo que va después de "Sinfonía".
   */
  const find = useCallback((alternatives: string[]): { cmd: Command; text: string } | { wakeOnly: true } | null => {
    let wakeOnly = false
    for (const alt of alternatives) {
      let part: string | null = alt
      if (noise.current) {
        part = afterWakeWord(alt)
        if (part === null) continue
        if (!part) { wakeOnly = true; continue }
      }
      const text = lastWords(part, 8)
      const cmd = parseCommand(text)
      // "modo ruido" / "modo normal" se aceptan siempre, aunque no se diga la palabra clave.
      if (cmd) return { cmd, text }
    }
    if (noise.current) {
      for (const alt of alternatives) {
        const cmd = parseCommand(lastWords(alt, 4))
        if (cmd?.type === 'noiseMode') return { cmd, text: lastWords(alt, 4) }
      }
    }
    return wakeOnly ? { wakeOnly: true } : null
  }, [])

  /** Ejecuta el comando y reinicia la escucha para borrar lo acumulado. */
  const fire = useCallback((cmd: Command, text: string) => {
    if (candidate.current) window.clearTimeout(candidate.current.timer)
    candidate.current = null
    session.current++
    if (engineRef.current === 'chrome') rec.current?.abort() // al terminar, se vuelve a encender sola y empieza limpia
    void execute(cmd, text)
  }, [execute])

  const miss = useCallback((text: string) => {
    const words = text.trim().split(/\s+/).length
    // Con ruido, la gente platica: solo se contesta "no entendí" a frases cortas, una vez cada 15 s.
    if (noise.current || words < 2 || words > 6 || performance.now() - lastMiss.current < 15000) return
    lastMiss.current = performance.now()
    setHeard(text)
    say('I did not understand. Say: what can I say.')
  }, [say])

  /** Una frase terminada (de Whisper o del navegador): buscar el comando y ejecutarlo. */
  const handleFinal = useCallback((alternatives: string[]) => {
    if (!alternatives.length || isEcho(alternatives[0])) return
    const found = find(alternatives)
    if (!found) { miss(alternatives[0]); return }
    if ('wakeOnly' in found) { say('Yes?'); return }
    stopSpeaking()
    fire(found.cmd, found.text)
  }, [find, miss, say, fire])

  const setEngine = useCallback((e: VoiceEngine) => { engineRef.current = e; setEngineState(e) }, [])

  /** Reconocedor del navegador (Google): respaldo si Whisper no está disponible. */
  const startBrowser = useCallback(() => {
    if (!Ctor || !wanted.current) return
    const r = new Ctor()
    const sid = ++session.current
    r.lang = 'en-US'
    r.continuous = true
    r.interimResults = true // revisa mientras hablas, sin esperar el silencio
    r.maxAlternatives = 3
    r.onstart = () => { setStatus('listening'); failures.current = 0 }
    // Con ruido la frase nunca se cierra: cada 12 s se reinicia para no acumular.
    const sessionTimer = window.setTimeout(() => { if (session.current === sid) r.abort() }, SESSION_MS)
    r.onresult = (e) => {
      if (session.current !== sid) return
      const res = e.results[e.results.length - 1]
      const alternatives = Array.from({ length: res.length }, (_, k) => res[k].transcript.trim()).filter(Boolean)
      if (res.isFinal) { handleFinal(alternatives); return }
      // Si es la propia voz de la app (con bocinas), se ignora.
      if (!alternatives.length || isEcho(alternatives[0])) return
      const found = find(alternatives)
      if (!found || 'wakeOnly' in found) return
      stopSpeaking() // la persona habla encima: la app se calla y obedece
      // Mientras se habla: se ejecuta cuando el comando deja de cambiar ("adelanta" → "adelanta 20 segundos").
      const key = JSON.stringify(found.cmd)
      if (candidate.current?.key === key) return
      if (candidate.current) window.clearTimeout(candidate.current.timer)
      const timer = window.setTimeout(() => {
        if (session.current === sid && candidate.current?.key === key) fire(found.cmd, found.text)
      }, STABLE_MS)
      candidate.current = { key, cmd: found.cmd, text: found.text, timer }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted.current = false
        remember(false)
        setStatus('denied')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        failures.current++
      }
    }
    // El navegador corta la escucha tras un rato: se reinicia sola mientras esté activada.
    r.onend = () => {
      window.clearTimeout(sessionTimer)
      if (rec.current === r) rec.current = null
      if (!wanted.current) return
      if (failures.current > 5) { setStatus('error'); wanted.current = false; return }
      window.setTimeout(() => startRef.current(), failures.current ? 1000 * failures.current : 150)
    }
    rec.current = r
    setStatus((s) => (s === 'listening' ? s : 'starting'))
    try { r.start() } catch { /* ya estaba escuchando */ }
  }, [Ctor, find, fire, handleFinal])

  const greet = useCallback(() => {
    const onPage = window.location.pathname.startsWith('/symphony') || window.location.pathname.startsWith('/jukebox')
    const first = onPage ? 'play' : 'start the tour'
    say(noise.current
      ? `I'm listening in noise mode. Say Symphony before each command. For example: Symphony, ${first}.`
      : `I'm listening. Say ${first}, or what can I say.`)
  }, [say])

  /** Whisper en el navegador: descarga el modelo la primera vez y abre el micrófono. */
  /** Respaldo: si Whisper falla, se usa Chrome sin cambiar la elección guardada. */
  const fallbackToChrome = useCallback((why: string) => {
    console.warn('Whisper large no disponible, uso Chrome:', why)
    whisper.current?.stop()
    if (!Ctor) { wanted.current = false; setStatus('error'); return }
    setEngine('chrome')
    say('I could not use Whisper large. Using Chrome speech recognition instead.')
    startBrowser()
    void defaultMicLabel().then(setMicLabel)
  }, [Ctor, say, setEngine, startBrowser])

  /** Whisper large-v3 (OpenRouter): revisa el servidor y abre el micrófono. */
  const startWhisper = useCallback(async (opts: { greet: boolean }) => {
    if (!wanted.current) return
    const w = (whisper.current ??= new WhisperListener())
    try {
      setStatus('loading')
      try {
        await w.load()
      } catch (err) {
        fallbackToChrome((err as Error).message)
        return
      }
      if (!wanted.current) return
      await w.start({
        onText: (t) => handleFinal([t]),
        onActivity: setActivity,
        onFatal: (msg) => fallbackToChrome(msg),
      })
      setMicLabel(w.micLabel)
      setStatus('listening')
      if (opts.greet) greet()
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        wanted.current = false
        remember(false)
        setStatus('denied')
        return
      }
      if ((err as Error)?.message === 'needs-gesture') {
        // Al abrir la página sin un clic, el navegador no deja usar el micrófono todavía.
        wanted.current = false
        setStatus('off')
        return
      }
      fallbackToChrome((err as Error)?.message ?? String(err))
    }
  }, [handleFinal, greet, fallbackToChrome])

  const start = useCallback((opts: { greet: boolean } = { greet: false }) => {
    if (engineRef.current === 'whisper') void startWhisper(opts)
    else {
      startBrowser()
      void defaultMicLabel().then(setMicLabel)
      if (opts.greet) greet()
    }
  }, [startWhisper, startBrowser, greet])

  /** Elegir reconocedor (botón): se guarda y, si está escuchando, cambia al momento. */
  const setChosen = useCallback((e: VoiceEngine) => {
    if (e === 'whisper' && !canWhisper) return
    saveRecognizer(e)
    setChosenState(e)
    const listening = wanted.current
    rec.current?.abort()
    whisper.current?.stop()
    setEngine(e)
    if (listening) start()
  }, [canWhisper, setEngine, start])

  const startRef = useRef(startBrowser)
  useEffect(() => { startRef.current = startBrowser }, [startBrowser])

  const toggle = useCallback(() => {
    if (!Ctor && !canWhisper) {
      setReply('This browser does not support speech recognition. Use Chrome or Edge.')
      return
    }
    if (wanted.current) {
      wanted.current = false
      remember(false)
      rec.current?.abort()
      whisper.current?.stop()
      setStatus('off')
      stopSpeaking()
      return
    }
    wanted.current = true
    failures.current = 0
    remember(true)
    // Vuelve al reconocedor elegido (por si antes Whisper falló y se usó Chrome de respaldo).
    setEngine(canWhisper && getRecognizer() === 'whisper' ? 'whisper' : 'chrome')
    start({ greet: true })
  }, [Ctor, canWhisper, start, setEngine])

  // Si ya se había activado antes y el micrófono está permitido, vuelve a escuchar sola al abrir la página.
  useEffect(() => {
    if ((!Ctor && !canWhisper) || !remembered()) return
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
    if (!perms?.query) return
    perms
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        if (p.state === 'granted' && !wanted.current) {
          wanted.current = true
          start()
        }
      })
      .catch(() => {})
  }, [Ctor, canWhisper, start])

  // Tecla V: activar o desactivar la voz (sin estar escribiendo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() === 'v') toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  useEffect(() => () => {
    wanted.current = false
    rec.current?.abort()
    whisper.current?.dispose()
  }, [])

  const setHandler = useCallback((h: VoiceHandler | null) => { handler.current = h }, [])
  const setPending = useCallback((c: Command | null) => { pending.current = c }, [])
  const takePending = useCallback(() => { const c = pending.current; pending.current = null; return c }, [])
  const value = useMemo<VoiceCtx>(
    () => ({ status, engine, chosen, setChosen, micLabel, activity, noiseMode, setNoiseMode, heard, reply, toggle, say, setHandler, setPending, takePending }),
    [status, engine, chosen, setChosen, micLabel, activity, noiseMode, setNoiseMode, heard, reply, toggle, say, setHandler, setPending, takePending],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVoice(): VoiceCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVoice fuera de VoiceProvider')
  return v
}

/**
 * Registra lo que hace la página con cada comando. Si la página anterior dejó un comando
 * pendiente (p. ej. "comienza" en la landing), se ejecuta al montarse.
 */
export function useVoiceHandler(h: VoiceHandler, ready = true) {
  const { setHandler, takePending, say } = useVoice()
  const latest = useRef(h)
  useEffect(() => { latest.current = h }, [h])
  useEffect(() => {
    setHandler((cmd) => latest.current(cmd))
    return () => setHandler(null)
  }, [setHandler])
  useEffect(() => {
    if (!ready) return
    const cmd = takePending()
    if (!cmd) return
    const id = window.setTimeout(async () => {
      const answer = await latest.current(cmd)
      if (answer) say(answer)
    }, 400)
    return () => window.clearTimeout(id)
  }, [ready, takePending, say])
}
