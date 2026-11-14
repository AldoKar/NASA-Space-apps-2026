import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatLat, type FrameFeatures } from './analysis/detector'
import { useLightningLoop, type LoopTick } from './analysis/useLightningLoop'
import { StormEngine, type LayerState } from './audio/stormEngine'
import { StrikeOverlay, type StrikeOverlayHandle } from './components/StrikeOverlay'
import { activityLabel, describeMoment, hemisphereLabel } from './describe'
import { TRACKS } from './tracks'
import './App.css'

const EMPTY: FrameFeatures = {
  activity: 0, meanLat: 0, northShare: 0.5, newRate: 0, strikes: [], peakEnergy: 0, isReset: true,
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return reduced
}

export default function App() {
  const track = TRACKS[0]
  const engine = useMemo(() => new StormEngine(), [])
  if (import.meta.env.DEV) (window as unknown as { __engine: StormEngine }).__engine = engine
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const overlayRef = useRef<StrikeOverlayHandle>(null)
  const reducedMotion = usePrefersReducedMotion()

  const [playing, setPlaying] = useState(false)
  const [layers, setLayers] = useState<LayerState>({ strikes: true, thunder: true, seasons: true })
  const [volume, setVolume] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [announce, setAnnounce] = useState(true)
  const [videoError, setVideoError] = useState(false)

  // Valores que se muestran (se actualizan ~5 veces por segundo, no en cada cuadro).
  const [shown, setShown] = useState({ f: EMPTY, chord: '', notesPerSec: 0, time: 0, duration: 0, level: 0, audio: 'off' })
  const latest = useRef({ f: EMPTY, chord: '', time: 0 })
  const notesWindow = useRef<number[]>([])
  const [liveText, setLiveText] = useState('')
  const lastAnnounce = useRef({ key: '', at: 0 })

  useEffect(() => engine.setLayers(layers), [engine, layers])
  useEffect(() => engine.setVolume(volume), [engine, volume])
  useEffect(() => {
    if (video) video.playbackRate = speed
  }, [video, speed])
  useEffect(() => () => engine.dispose(), [engine])

  const onTick = useCallback((t: LoopTick) => {
    latest.current = { f: t.features, chord: t.chord || latest.current.chord, time: t.videoTime }
    if (t.played.length) {
      overlayRef.current?.addStrikes(t.played)
      const now = performance.now()
      for (let i = 0; i < t.played.length; i++) notesWindow.current.push(now)
    }
    if (t.thunder) overlayRef.current?.addThunder(t.thunder)
  }, [])

  useLightningLoop(video, engine, onTick)

  // Refresco de indicadores + anuncios para lector de pantalla.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now()
      notesWindow.current = notesWindow.current.filter((x) => now - x < 1000)
      const { f, chord, time } = latest.current
      setShown({
        f, chord, time,
        notesPerSec: notesWindow.current.length,
        duration: video?.duration || 0,
        level: engine.getLevel(),
        audio: engine.isStarted ? engine.contextState : 'off',
      })
      if (announce && playing && f.activity > 0.01) {
        const key = `${activityLabel(f.activity)}|${hemisphereLabel(f.meanLat)}`
        if (key !== lastAnnounce.current.key && now - lastAnnounce.current.at > 8000) {
          lastAnnounce.current = { key, at: now }
          setLiveText(
            `Actividad ${activityLabel(f.activity)}, tormentas ${hemisphereLabel(f.meanLat)}.`,
          )
        }
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [video, announce, playing, engine])

  const progressPct = shown.duration ? (shown.time / shown.duration) * 100 : 0

  const togglePlay = useCallback(async () => {
    if (!video) return
    if (video.paused) {
      await engine.start()
      engine.setLayers(layers)
      engine.setVolume(volume)
      if (video.ended) video.currentTime = 0
      await video.play()
    } else {
      video.pause()
    }
  }, [video, engine, layers, volume])

  const restart = useCallback(() => {
    if (video) video.currentTime = 0
  }, [video])

  const seekBy = useCallback((s: number) => {
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + s))
  }, [video])

  const describeNow = useCallback(() => {
    // Cambiar el texto aunque sea igual fuerza a que el lector lo repita.
    setLiveText('')
    window.setTimeout(() => setLiveText(describeMoment(latest.current.f, progressPct)), 50)
  }, [progressPct])

  const testSound = useCallback(async () => {
    await engine.start()
    engine.setLayers(layers)
    engine.setVolume(volume)
    engine.testSound()
  }, [engine, layers, volume])

  const toggleLayer = useCallback((k: keyof LayerState) => {
    setLayers((l) => ({ ...l, [k]: !l[k] }))
  }, [])

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      if (e.key === ' ' && !typing && tag !== 'BUTTON') {
        e.preventDefault()
        void togglePlay()
      } else if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        return
      } else if (e.key === '1') toggleLayer('strikes')
      else if (e.key === '2') toggleLayer('thunder')
      else if (e.key === '3') toggleLayer('seasons')
      else if (e.key.toLowerCase() === 'd') describeNow()
      else if (e.key.toLowerCase() === 'r') restart()
      else if (e.key === 'ArrowRight') seekBy(5)
      else if (e.key === 'ArrowLeft') seekBy(-5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, toggleLayer, describeNow, restart, seekBy])

  const f = shown.f
  const latPct = ((Math.max(-50, Math.min(50, f.meanLat)) + 50) / 100) * 100

  return (
    <div className="app">
      <a className="skip" href="#controles">Saltar a los controles</a>
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Earth Jukebox</h1>
            <p className="tagline">Escucha cómo cambia la Tierra, con datos visuales de la NASA</p>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="stage" aria-labelledby="track-title">
          <div className="track-head">
            <p className="eyebrow">Pista 1</p>
            <h2 id="track-title">{track.title}</h2>
            <p className="subtitle">{track.subtitle}</p>
          </div>

          <figure className="viewer">
            <div className="video-wrap">
              <video
                ref={setVideo}
                src={track.videoSrc}
                muted
                playsInline
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); engine.silence() }}
                onEnded={() => { setPlaying(false); engine.silence() }}
                onError={() => setVideoError(true)}
                aria-describedby="visual-desc"
              />
              <StrikeOverlay ref={overlayRef} reducedMotion={reducedMotion} />
              {!playing && (
                <button className="big-play" onClick={() => void togglePlay()} aria-label="Reproducir pista con sonido">
                  <span aria-hidden="true">▶</span>
                </button>
              )}
            </div>
            <figcaption id="visual-desc" className="visual-desc">{track.visualDescription}</figcaption>
            {videoError && (
              <p className="error" role="alert">
                No se encontró el video. Copia el archivo a <code>public{track.videoSrc}</code> (ver README).
              </p>
            )}
          </figure>

          <div className="timeline">
            <span>{track.periodStart}</span>
            <input
              type="range"
              min={0}
              max={shown.duration || 100}
              step={0.1}
              value={shown.time}
              onChange={(e) => { if (video) video.currentTime = Number(e.target.value) }}
              aria-label="Posición en el periodo 2017 a 2023"
              aria-valuetext={`${Math.round(progressPct)} por ciento del periodo`}
            />
            <span>{track.periodEnd}</span>
          </div>

          <div id="controles" className="controls" role="group" aria-label="Controles de reproducción">
            <button className="primary" onClick={() => void togglePlay()} aria-keyshortcuts="Space">
              {playing ? 'Pausa' : 'Reproducir'}
            </button>
            <button onClick={restart} aria-keyshortcuts="R">Reiniciar</button>
            <button onClick={describeNow} aria-keyshortcuts="D">Describir este momento</button>
            <button onClick={() => void testSound()}>Probar sonido</button>
            <label className="inline">
              Velocidad
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
              </select>
            </label>
            <label className="inline">
              Volumen
              <input
                type="range" min={-30} max={0} step={1} value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-valuetext={`${volume} decibeles`}
              />
            </label>
          </div>
        </section>

        <aside className="panel" aria-label="Lo que estás escuchando">
          <h2 className="panel-title">Capas de sonido</h2>
          <div className="layers" role="group" aria-label="Activar o silenciar capas">
            <LayerToggle
              on={layers.strikes} onClick={() => toggleLayer('strikes')} shortcut="1"
              name="Rayos" hint="Cada rayo nuevo es una nota. Norte agudo, sur grave; oeste a la izquierda, este a la derecha."
            />
            <LayerToggle
              on={layers.thunder} onClick={() => toggleLayer('thunder')} shortcut="2"
              name="Truenos" hint="Un grupo grande de rayos juntos produce un retumbo, con retraso como en la vida real."
            />
            <LayerToggle
              on={layers.seasons} onClick={() => toggleLayer('seasons')} shortcut="3"
              name="Estaciones" hint="El acorde de fondo sube o baja según hacia dónde se mueven las tormentas."
            />
          </div>

          <h2 className="panel-title">En este momento</h2>
          <dl className="readouts">
            <div>
              <dt>Actividad (10 días)</dt>
              <dd>
                <meter min={0} max={1} value={f.activity} aria-label="Actividad eléctrica">{activityLabel(f.activity)}</meter>
                <span className="val">{activityLabel(f.activity)}</span>
              </dd>
            </div>
            <div>
              <dt>Rayos nuevos</dt>
              <dd>
                <meter min={0} max={1} value={f.newRate} aria-label="Intensidad de rayos nuevos" />
                <span className="val">{shown.notesPerSec} notas/s</span>
              </dd>
            </div>
            <div>
              <dt>Centro de las tormentas</dt>
              <dd className="lat">
                <span className="lat-bar" aria-hidden="true">
                  <span className="lat-eq" />
                  <span className="lat-dot" style={{ bottom: `${latPct}%` }} />
                </span>
                <span className="val">
                  {f.activity > 0.01 ? formatLat(f.meanLat) : '—'}
                  <small>{f.activity > 0.01 ? hemisphereLabel(f.meanLat) : ''}</small>
                </span>
              </dd>
            </div>
            <div>
              <dt>Acorde de la estación</dt>
              <dd><span className="val">{shown.chord || '—'}</span></dd>
            </div>
          </dl>

          <div className="audio-status">
            <span>Audio: {shown.audio === 'running' ? 'activo' : shown.audio === 'off' ? 'apagado (presiona Reproducir)' : 'bloqueado por el navegador'}</span>
            <meter min={0} max={0.6} value={shown.level} aria-label="Nivel de salida de audio" />
          </div>

          <label className="check">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            Anunciar cambios al lector de pantalla
          </label>

          <details className="keys">
            <summary>Atajos de teclado</summary>
            <ul>
              <li><kbd>Espacio</kbd> reproducir / pausa</li>
              <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> capas</li>
              <li><kbd>D</kbd> describir este momento</li>
              <li><kbd>←</kbd> <kbd>→</kbd> retroceder / avanzar 5 s</li>
              <li><kbd>R</kbd> reiniciar</li>
            </ul>
          </details>
        </aside>
      </main>

      <footer className="foot">
        <p>
          Datos visuales: <a href={track.source.url} target="_blank" rel="noreferrer">{track.source.label}</a>,
          NASA Scientific Visualization Studio. El sensor LIS solo ve cada zona cuando la Estación
          Espacial pasa por encima: es una muestra de los rayos del planeta, no un conteo total.
        </p>
      </footer>

      <div className="sr-only" role="status" aria-live="polite">{liveText}</div>
    </div>
  )
}

function LayerToggle(props: { on: boolean; onClick: () => void; name: string; hint: string; shortcut: string }) {
  return (
    <button
      className={`layer ${props.on ? 'on' : ''}`}
      aria-pressed={props.on}
      onClick={props.onClick}
      aria-keyshortcuts={props.shortcut}
    >
      <span className="layer-name">
        <span className="led" aria-hidden="true" />
        {props.name}
        <kbd aria-hidden="true">{props.shortcut}</kbd>
      </span>
      <span className="layer-hint">{props.hint}</span>
    </button>
  )
}
