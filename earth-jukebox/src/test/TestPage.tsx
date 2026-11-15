import { useEffect, useRef, useState } from 'react'
import { parseCommand, type Command } from '../voice/commands'
import { cleanTranscript } from '../voice/vad'
import { defaultMicLabel, getRecognizer, getSensitivity, saveRecognizer, saveSensitivity, WhisperListener } from '../voice/whisperListener'
import type { DropReason } from '../voice/vad'
import './test.css'

/**
 * /test — Prueba de voz: muestra tal cual lo que el reconocimiento obtiene del micrófono.
 * No ejecuta comandos; solo dice cuál entendería la app.
 */

type Engine = 'whisper' | 'chrome'
interface Entry {
  id: number
  /** Sonido que no se mandó a Whisper. */
  dropped?: { reason: DropReason; seconds: number }
  at: string
  engine: Engine
  raw: string
  /** Whisper: texto tras quitar frases inventadas ('' = descartada). Google: igual al crudo. */
  clean: string
  command: Command | null
  audioSeconds?: number
  ms?: number
  alternatives?: string[]
}

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  start: () => void; abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

const COMMAND_TEXT: Record<Command['type'], (c: never) => string> = {
  play: () => 'Play',
  pause: () => 'Pause',
  resume: () => 'Resume',
  restart: () => 'Restart',
  seek: (c: { seconds: number }) => `${c.seconds > 0 ? 'Skip forward' : 'Go back'} ${Math.abs(c.seconds)} s`,
  goto: (c: { target: string }) => `Go to: ${({ incendio: 'Dixie Fire', rayos: 'Storms', inicio: 'Home' } as Record<string, string>)[c.target] ?? c.target}`,
  tour: (c: { dir: number }) => (c.dir > 0 ? 'Next section' : 'Previous section'),
  volume: (c: { dir: number }) => (c.dir > 0 ? 'Volume up' : 'Volume down'),
  speed: (c: { value: number }) => `Speed ${c.value}×`,
  layer: (c: { layer: string; on: boolean }) => `Turn ${c.on ? 'on' : 'off'} layer: ${({ rayos: 'lightning', truenos: 'thunder', estaciones: 'seasons', fuego: 'active fire', frente: 'fire front', quemada: 'burned area' } as Record<string, string>)[c.layer] ?? c.layer}`,
  describe: () => 'Describe this moment',
  help: () => 'Help',
  stopListening: () => 'Stop listening',
}
const describeCommand = (c: Command) => (COMMAND_TEXT[c.type] as (c: Command) => string)(c)
const now = () => new Date().toLocaleTimeString('en-US', { hour12: false })

export default function TestPage() {
  const [engine, setEngine] = useState<Engine>(getRecognizer)
  const [mic, setMic] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Stopped')
  const [interim, setInterim] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [device, setDevice] = useState('')
  const [sensitivity, setSens] = useState(getSensitivity)
  const whisper = useRef<WhisperListener | null>(null)
  const rec = useRef<Recognition | null>(null)
  const wantGoogle = useRef(false)
  const nextId = useRef(1)
  const level = useRef({ db: -100, floorDb: -60, thresholdDb: -50, speaking: false })
  const meter = useRef<HTMLDivElement>(null)

  const add = (e: Omit<Entry, 'id' | 'at'>) => setEntries((list) => [{ ...e, id: nextId.current++, at: now() }, ...list].slice(0, 60))

  // Medidor: se dibuja con requestAnimationFrame (el nivel llega cada pocos milisegundos).
  useEffect(() => {
    let raf = 0
    const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100))
    const draw = () => {
      const el = meter.current
      if (el) {
        const l = level.current
        el.style.setProperty('--lvl', `${toPct(l.db)}%`)
        el.style.setProperty('--floor', `${toPct(l.floorDb)}%`)
        el.style.setProperty('--thr', `${toPct(l.thresholdDb)}%`)
        el.dataset.speaking = String(l.speaking)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stop = () => {
    wantGoogle.current = false
    rec.current?.abort()
    rec.current = null
    whisper.current?.stop()
    level.current = { db: -100, floorDb: -60, thresholdDb: -50, speaking: false }
    setRunning(false)
    setInterim('')
    setStatus('Stopped')
  }

  const startWhisper = async () => {
    const w = (whisper.current ??= new WhisperListener())
    setRunning(true)
    try {
      setStatus('Connecting to OpenRouter…')
      await w.load()
      setDevice('OpenRouter (large-v3)')
      await w.start({
        onText: () => {},
        onActivity: (a) => setStatus(a === 'speech' ? 'Hearing you…' : a === 'processing' ? 'Whisper transcribing…' : 'Listening'),
        onRaw: (raw, info) => {
          const clean = cleanTranscript(raw)
          add({ engine: 'whisper', raw, clean, command: clean ? parseCommand(clean) : null, audioSeconds: info.audioSeconds, ms: info.ms })
        },
        onLevel: (l) => { level.current = l },
        onDrop: (reason, seconds) => add({ engine: 'whisper', raw: '', clean: '', command: null, dropped: { reason, seconds } }),
        onFatal: (msg) => setStatus(`OpenRouter failed: ${msg}`),
      })
      setMic(w.micLabel)
      setStatus('Listening')
    } catch (err) {
      setRunning(false)
      setStatus(`Error: ${(err as Error)?.message ?? err}. Did you set OPENROUTER_API_KEY in .env.local (local) or in Vercel?`)
    }
  }

  const startGoogle = () => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { setStatus('This browser does not have Google speech recognition'); return }
    wantGoogle.current = true
    setRunning(true)
    const launch = () => {
      if (!wantGoogle.current) return
      const r = new Ctor()
      r.lang = 'es-MX'
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 3
      r.onresult = (e) => {
        const res = e.results[e.results.length - 1]
        const alts = Array.from({ length: res.length }, (_, k) => res[k].transcript.trim()).filter(Boolean)
        if (!res.isFinal) { setInterim(alts[0] ?? ''); return }
        setInterim('')
        add({ engine: 'chrome', raw: alts[0] ?? '', clean: alts[0] ?? '', command: alts.map((a) => parseCommand(a)).find(Boolean) ?? null, alternatives: alts.slice(1) })
      }
      r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setStatus(`Google error: ${e.error}`) }
      r.onend = () => { if (wantGoogle.current) window.setTimeout(launch, 200) }
      rec.current = r
      r.start()
      setStatus('Listening')
      void defaultMicLabel().then(setMic)
    }
    launch()
  }

  const toggle = () => {
    if (running) stop()
    else if (engine === 'whisper') void startWhisper()
    else startGoogle()
  }

  const changeSensitivity = (v: number) => {
    setSens(v)
    if (whisper.current) whisper.current.setSensitivity(v)
    else saveSensitivity(v)
  }

  const switchEngine = (e: Engine) => {
    if (e === engine) return
    stop()
    setEngine(e)
    saveRecognizer(e)
  }

  useEffect(() => () => { wantGoogle.current = false; rec.current?.abort(); whisper.current?.dispose() }, [])

  return (
    <main className="vt">
      <header className="vt-head">
        <div>
          <h1>Voice test</h1>
          <p>Exactly what speech recognition gets from your microphone. No commands are run on this page.</p>
        </div>
        <a href="/symphony" className="vt-link">Back to the app</a>
      </header>

      <section className="vt-controls" aria-label="Controls">
        <div className="vt-engines" role="radiogroup" aria-label="Recognizer">
          <button type="button" role="radio" aria-checked={engine === 'whisper'} onClick={() => switchEngine('whisper')}>Whisper large (OpenRouter)</button>
          <button type="button" role="radio" aria-checked={engine === 'chrome'} onClick={() => switchEngine('chrome')}>Chrome (Google)</button>
        </div>
        <button type="button" className={`vt-start ${running ? 'is-on' : ''}`} onClick={toggle}>
          {running ? 'Stop' : 'Start listening'}
        </button>
        <p className="vt-status" aria-live="polite">
          {status}
          {device && engine === 'whisper' && running && <span className="vt-device"> · Whisper on {device}</span>}
          {mic && running && <span className="vt-device"> · microphone: {mic}</span>}
        </p>
      </section>

      {engine === 'whisper' && (
        <section className="vt-meter-wrap" aria-label="Microphone level">
          <div className="vt-meter" ref={meter} data-speaking="false">
            <span className="vt-meter-fill" />
            <span className="vt-meter-floor" title="Background noise" />
            <span className="vt-meter-thr" title="Above this counts as voice" />
          </div>
          <label className="vt-sens">
            <span>Microphone sensitivity</span>
            <input
              type="range" min={0} max={1} step={0.05} value={sensitivity}
              onChange={(e) => changeSensitivity(Number(e.target.value))}
              aria-valuetext={`${Math.round(sensitivity * 100)} percent`}
            />
            <span className="vt-sens-val">{sensitivity <= 0.3 ? 'Low (very noisy place)' : sensitivity >= 0.7 ? 'High (quiet place)' : 'Medium'}</span>
          </label>
          <p className="vt-hint">
            Speak normally close to the microphone and move the sensitivity until the bar turns blue only with your voice, not with the chatter around you. The app uses the same value.
          </p>
          <p className="vt-legend">
            <span className="vt-key vt-key-fill" /> your microphone
            <span className="vt-key vt-key-floor" /> background noise
            <span className="vt-key vt-key-thr" /> above this counts as voice (the bar turns blue)
          </p>
        </section>
      )}

      {engine === 'chrome' && interim && (
        <p className="vt-interim"><span>Hearing:</span> {interim}</p>
      )}

      <section aria-label="What was heard" className="vt-list">
        {entries.length === 0 && <p className="vt-empty">Press “Start listening” and say something, for example: “pause the simulator”.</p>}
        {entries.map((e) => (
          e.dropped ? (
            <article key={e.id} className="vt-item vt-drop">
              <div className="vt-meta"><span>{e.at}</span><span>Voice detector</span><span>{e.dropped.seconds.toFixed(1)} s sound</span></div>
              <p className="vt-cmd vt-cmd-junk">
                {e.dropped.reason === 'muy-largo'
                  ? 'Ignored without sending it to Whisper: too long to be a command (chatter or continuous noise).'
                  : 'Ignored: too short (a knock or noise).'}
              </p>
            </article>
          ) : (
          <article key={e.id} className={`vt-item ${e.engine === 'whisper' && !e.clean ? 'is-junk' : ''}`}>
            <div className="vt-meta">
              <span>{e.at}</span>
              <span>{e.engine === 'whisper' ? 'Whisper large' : 'Chrome'}</span>
              {e.audioSeconds !== undefined && <span>audio {e.audioSeconds.toFixed(1)} s</span>}
              {e.ms !== undefined && <span>took {Math.round(e.ms)} ms</span>}
            </div>
            <p className="vt-raw">“{e.raw.trim() || '(empty)'}”</p>
            {e.alternatives && e.alternatives.length > 0 && (
              <p className="vt-alts">Other versions: {e.alternatives.map((a) => `“${a}”`).join(' · ')}</p>
            )}
            {e.engine === 'whisper' && !e.clean ? (
              <p className="vt-cmd vt-cmd-junk">Discarded: looks like a phrase Whisper makes up from noise.</p>
            ) : e.command ? (
              <p className="vt-cmd">Command the app would understand: <strong>{describeCommand(e.command)}</strong></p>
            ) : (
              <p className="vt-cmd vt-cmd-none">Not a command.</p>
            )}
          </article>
          )
        ))}
      </section>
    </main>
  )
}
