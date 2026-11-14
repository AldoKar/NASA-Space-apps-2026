import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatLat, type FrameFeatures } from './analysis/detector'
import { loopStats, useLightningLoop, type LoopTick } from './analysis/useLightningLoop'
import { StormEngine, type EngineStats, type LayerState } from './audio/stormEngine'
import { REGION_NAME } from './audio/melody'
import { StrikeOverlay, type StrikeOverlayHandle } from './components/StrikeOverlay'
import { activityLabel, describeMoment, hemisphereLabel, sideLabel } from './describe'
import { TRACKS } from './tracks'
import { Gauge, Icon, Section, Segmented, Switch } from './ui/controls'
import { useSpring } from './ui/useSpring'
import './App.css'

const EMPTY: FrameFeatures = {
  activity: 0, meanLat: 0, northShare: 0.5, newRate: 0, strikes: [], peakEnergy: 0, isReset: true,
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const fn = () => setMatch(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [query])
  return match
}

export default function App() {
  const track = TRACKS[0]
  const engine = useMemo(() => new StormEngine(), [])
  if (import.meta.env.DEV) (window as unknown as { __engine: StormEngine }).__engine = engine
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const overlayRef = useRef<StrikeOverlayHandle>(null)
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), [])
  const [diag, setDiag] = useState<(EngineStats & { frameErrors: number; restarts: number; analysisMs: number }) | null>(null)

  const [playing, setPlaying] = useState(false)
  const [layers, setLayers] = useState<LayerState>({ strikes: true, thunder: true, seasons: true })
  const [volume, setVolume] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [announce, setAnnounce] = useState(true)
  const [videoError, setVideoError] = useState(false)

  const [shown, setShown] = useState({ f: EMPTY, chord: '', notesPerSec: 0, time: 0, duration: 0, level: 0, audio: 'off', balance: null as number | null, last: '' })
  const latest = useRef({ f: EMPTY, chord: '', time: 0, balance: null as number | null, last: '' })
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
    // Balance suavizado para que el indicador no tiemble.
    const prevB = latest.current.balance
    const balance = t.balance === null ? prevB : prevB === null ? t.balance : prevB * 0.85 + t.balance * 0.15
    let last = latest.current.last
    const p = t.played[t.played.length - 1]
    if (p) {
      const arrow = p.direction === 1 ? ' ↑' : p.direction === -1 ? ' ↓' : ''
      const kind = p.voices === 3 ? 'arpegio' : p.voices === 2 ? 'dos notas' : 'una nota'
      last = `${REGION_NAME[p.region]} · ${p.level} · ${p.land ? 'tierra' : 'océano'} · ${kind}${arrow}${p.isNew ? ' · nueva' : ''}`
    }
    latest.current = { f: t.features, chord: t.chord || latest.current.chord, time: t.videoTime, balance, last }
    if (t.played.length) {
      overlayRef.current?.addStrikes(t.played)
      const now = performance.now()
      for (let i = 0; i < t.played.length; i++) notesWindow.current.push(now)
    }
    if (t.thunder) overlayRef.current?.addThunder(t.thunder)
  }, [])

  useLightningLoop(video, engine, onTick)

  // Indicadores (~5 veces por segundo) y anuncios para lector de pantalla.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now()
      notesWindow.current = notesWindow.current.filter((x) => now - x < 1000)
      const { f, chord, time, balance, last } = latest.current
      setShown({
        f, chord, time, balance, last,
        notesPerSec: notesWindow.current.length,
        duration: video?.duration || 0,
        level: engine.getLevel(),
        audio: engine.isStarted ? engine.contextState : 'off',
      })
      if (debug) setDiag({ ...engine.getStats(), ...loopStats })
      if (announce && playing && f.activity > 0.01) {
        const key = `${activityLabel(f.activity)}|${hemisphereLabel(f.meanLat)}`
        if (key !== lastAnnounce.current.key && now - lastAnnounce.current.at > 8000) {
          lastAnnounce.current = { key, at: now }
          setLiveText(`Actividad ${activityLabel(f.activity)}, tormentas ${hemisphereLabel(f.meanLat)}.`)
        }
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [video, announce, playing, engine, debug])

  const progressPct = shown.duration ? (shown.time / shown.duration) * 100 : 0

  const startAudio = useCallback(async () => {
    await engine.start()
    engine.setLayers(layers)
    engine.setVolume(volume)
  }, [engine, layers, volume])

  const togglePlay = useCallback(async () => {
    if (!video) return
    if (video.paused) {
      await startAudio()
      if (video.ended) video.currentTime = 0
      // Si se pausa antes de que arranque, el navegador cancela play(): no es un error.
      await video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [video, startAudio])

  const restart = useCallback(() => {
    if (video) video.currentTime = 0
  }, [video])

  const seekBy = useCallback((s: number) => {
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + s))
  }, [video])

  const describeNow = useCallback(() => {
    setLiveText('')
    window.setTimeout(() => setLiveText(describeMoment(latest.current.f, progressPct, latest.current.balance)), 50)
  }, [progressPct])

  const testSound = useCallback(async () => {
    await startAudio()
    engine.testSound()
  }, [engine, startAudio])

  const setLayer = useCallback((k: keyof LayerState, v?: boolean) => {
    setLayers((l) => ({ ...l, [k]: v ?? !l[k] }))
  }, [])

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      const onButton = tag === 'BUTTON'
      if (e.key === ' ' && !typing && !onButton) {
        e.preventDefault()
        void togglePlay()
      } else if (typing || e.metaKey || e.ctrlKey || e.altKey) {
        return
      } else if (e.key === '1') setLayer('strikes')
      else if (e.key === '2') setLayer('thunder')
      else if (e.key === '3') setLayer('seasons')
      else if (e.key.toLowerCase() === 'd') describeNow()
      else if (e.key.toLowerCase() === 'r') restart()
      else if (e.key === 'ArrowRight') seekBy(5)
      else if (e.key === 'ArrowLeft') seekBy(-5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, setLayer, describeNow, restart, seekBy])

  const f = shown.f
  const hasData = f.activity > 0.01
  // Riel de latitud: posición vertical exacta sobre el mapa equirectangular.
  const latTarget = hasData ? f.meanLat : 0
  const latSpring = useSpring(latTarget, 0.6, reducedMotion)
  const latTop = ((90 - latSpring) / 180) * 100
  const activitySpring = useSpring(f.activity, 0.4, reducedMotion)
  const newSpring = useSpring(f.newRate, 0.3, reducedMotion)
  const levelSpring = useSpring(Math.min(1, shown.level / 0.6), 0.15, reducedMotion)
  const balanceSpring = useSpring(shown.balance ?? 0, 0.35, reducedMotion)

  const audioLabel =
    shown.audio === 'running' ? 'Activo' : shown.audio === 'off' ? 'Apagado' : 'Bloqueado'

  return (
    <div className="app">
      <a className="skip" href="#transport">Saltar a los controles</a>

      <header className="masthead">
        <p className="app-name">
          <span className="app-glyph" aria-hidden="true" />
          Earth Jukebox
        </p>
        <h1 className="display">{track.title}</h1>
        <p className="lede">{track.subtitle}</p>
      </header>

      <main className="layout">
        <section className="stage" aria-label="Visualización y reproducción">
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

              {/* Línea vertical al centro: divide el mapa entre audífono izquierdo y derecho */}
              <div className="pan-guide" aria-hidden="true">
                <span className="pan-line" />
                <span className="pan-tag left">Izquierda</span>
                <span className="pan-tag right">Derecha</span>
              </div>

              {/* Elemento distintivo: el centro de las tormentas sobre el eje de latitud del mapa */}
              <div className={`lat-rail ${hasData ? 'is-live' : ''}`} aria-hidden="true">
                <span className="lat-rail-line" />
                <span className="lat-rail-eq" />
                <span className="lat-marker" style={{ top: `${latTop}%` }}>
                  <span className="lat-dot" />
                  <span className="lat-pill">{hasData ? formatLat(f.meanLat) : '—'}</span>
                </span>
              </div>

              {!playing && (
                <button className="hero-play" onClick={() => void togglePlay()} aria-label="Reproducir con sonido">
                  {Icon.play}
                </button>
              )}

              {/* Capa funcional: única superficie de vidrio, flotando sobre el contenido */}
              <div id="transport" className="transport glass" role="group" aria-label="Reproducción">
                <button
                  className="t-btn t-primary"
                  onClick={() => void togglePlay()}
                  aria-label={playing ? 'Pausa' : 'Reproducir'}
                  aria-keyshortcuts="Space"
                >
                  {playing ? Icon.pause : Icon.play}
                </button>
                <button className="t-btn" onClick={restart} aria-label="Reiniciar" aria-keyshortcuts="R">
                  {Icon.restart}
                </button>
                <span className="t-date">{track.periodStart}</span>
                <input
                  className="scrubber"
                  type="range"
                  min={0}
                  max={shown.duration || 100}
                  step={0.1}
                  value={shown.time}
                  style={{ ['--p' as string]: `${progressPct}%` }}
                  onChange={(e) => { if (video) video.currentTime = Number(e.target.value) }}
                  aria-label="Posición en el periodo 2017 a 2023"
                  aria-valuetext={`${Math.round(progressPct)} por ciento del periodo`}
                />
                <span className="t-date">{track.periodEnd}</span>
                <span className="t-vol">
                  {Icon.speaker}
                  <input
                    className="scrubber vol"
                    type="range" min={-30} max={0} step={1} value={volume}
                    style={{ ['--p' as string]: `${((volume + 30) / 30) * 100}%` }}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volumen"
                    aria-valuetext={`${volume} decibeles`}
                  />
                </span>
              </div>
            </div>
            <figcaption id="visual-desc" className="caption">{track.visualDescription}</figcaption>
            {videoError && (
              <p className="error" role="alert">
                No se encontró el video. Copia el archivo a <code>public{track.videoSrc}</code>.
              </p>
            )}
          </figure>
        </section>

        <aside className="inspector" aria-label="Lo que estás escuchando">
          <Section
            title="Capas de sonido"
            footer="Cada región tiene su voz: América grave (izquierda), Europa y África media (centro), Asia y Oceanía aguda (derecha), y se contestan entre sí. La melodía sube cuando las tormentas van al norte. Una tormenta que crece arpegia hacia arriba; una que se encoge, hacia abajo. Sobre tierra suena un piano eléctrico suave y sobre el océano un vibráfono."
          >
            <Switch
              label="Rayos" description="Grupos grandes: melodía · chicos: destellos agudos" shortcut="1"
              checked={layers.strikes} onChange={(v) => setLayer('strikes', v)}
            />
            <Switch
              label="Truenos" description="Grupos muy grandes retumban en el tono del acorde" shortcut="2"
              checked={layers.thunder} onChange={(v) => setLayer('thunder', v)}
            />
            <Switch
              label="Estaciones" description="Acorde de fondo; la melodía usa sus notas" shortcut="3"
              checked={layers.seasons} onChange={(v) => setLayer('seasons', v)}
            />
          </Section>

          <Section title="En este momento">
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Actividad</span>
                <span className="row-value">{hasData ? activityLabel(f.activity) : '—'}</span>
              </div>
              <Gauge value={activitySpring} label="Actividad de los últimos 10 días" valueText={activityLabel(f.activity)} />
            </div>
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Rayos nuevos</span>
                <span className="row-value tabular">{shown.notesPerSec} grupos/s</span>
              </div>
              <Gauge value={newSpring} label="Intensidad de rayos nuevos" valueText={`${shown.notesPerSec} grupos grandes por segundo`} />
            </div>
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Audífonos</span>
                <span className="row-value">{playing ? sideLabel(shown.balance) : '—'}</span>
              </div>
              <div
                className="balance"
                role="meter"
                aria-label="Balance izquierda derecha de los rayos nuevos"
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={Number((shown.balance ?? 0).toFixed(2))}
                aria-valuetext={sideLabel(shown.balance)}
              >
                <span className="balance-l">I</span>
                <span className="balance-track">
                  <span className="balance-mid" />
                  <span className="balance-dot" style={{ left: `${50 + balanceSpring * 50}%` }} />
                </span>
                <span className="balance-r">D</span>
              </div>
            </div>
            <div className="row">
              <div className="row-text">
                <span className="row-label">Centro de tormentas</span>
                <span className="row-sub">{hasData ? hemisphereLabel(f.meanLat) : 'Sin datos aún'}</span>
              </div>
              <span className="row-value tabular">{hasData ? formatLat(f.meanLat) : '—'}</span>
            </div>
            <div className="row">
              <div className="row-text">
                <span className="row-label">Último grupo grande</span>
                <span className="row-sub">{shown.last || 'Esperando…'}</span>
              </div>
            </div>
            <div className="row">
              <span className="row-label">Acorde</span>
              <span className="row-value">{shown.chord || '—'}</span>
            </div>
          </Section>

          <Section title="Reproducción">
            <div className="row">
              <span className="row-label">Velocidad</span>
              <Segmented
                label="Velocidad"
                value={speed}
                onChange={setSpeed}
                options={[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }]}
              />
            </div>
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Audio</span>
                <span className={`row-value status-${shown.audio === 'running' ? 'ok' : 'off'}`}>{audioLabel}</span>
              </div>
              <Gauge value={levelSpring} label="Nivel de salida de audio" valueText={audioLabel} />
            </div>
            <button className="row row-action" onClick={() => void testSound()}>
              <span className="row-icon">{Icon.wave}</span>Probar sonido
            </button>
          </Section>

          <Section title="Accesibilidad" footer={<>Atajos: <kbd>Espacio</kbd> reproducir · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> capas · <kbd>D</kbd> describir · <kbd>←</kbd><kbd>→</kbd> ±5 s · <kbd>R</kbd> reiniciar</>}>
            <button className="row row-action" onClick={describeNow} aria-keyshortcuts="D">
              <span className="row-icon">{Icon.describe}</span>Describir este momento
            </button>
            <Switch label="Anunciar cambios" description="Para lectores de pantalla" checked={announce} onChange={setAnnounce} />
          </Section>
          {debug && diag && (
            <Section title="Diagnóstico" footer="Visible solo con ?debug en la dirección. Errores debe quedarse en 0 y los reinicios del bucle no deben subir.">
              <DiagRow label="Notas por segundo" value={`${diag.notesPerSec}`} />
              <DiagRow label="Notas omitidas por saturación" value={`${diag.dropped} de ${diag.dropped + diag.admitted}`} />
              <DiagRow label="Errores" value={`${diag.errors}`} />
              {diag.lastError && <DiagRow label="Último error" value={diag.lastError} />}
              <DiagRow label="Reinicios del bucle" value={`${diag.restarts}`} />
              <DiagRow label="Reanudaciones de audio" value={`${diag.resumes}`} />
              <DiagRow label="Análisis por cuadro" value={`${diag.analysisMs.toFixed(1)} ms`} />
              <DiagRow label="Contexto de audio" value={diag.context} />
            </Section>
          )}
        </aside>
      </main>

      <footer className="foot">
        Datos visuales: <a href={track.source.url} target="_blank" rel="noreferrer">{track.source.label}</a>, NASA
        Scientific Visualization Studio. El sensor LIS solo ve cada zona cuando la Estación Espacial pasa por
        encima: es una muestra de los rayos del planeta, no un conteo total.
      </footer>

      <div className="sr-only" role="status" aria-live="polite">{liveText}</div>
    </div>
  )
}

function DiagRow(props: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="row-label">{props.label}</span>
      <span className="row-value tabular">{props.value}</span>
    </div>
  )
}
