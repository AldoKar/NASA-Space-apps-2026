import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatLat, type FrameFeatures } from './analysis/detector'
import { loopStats, useLightningLoop, type LoopTick } from './analysis/useLightningLoop'
import { StormEngine, type EngineStats, type LayerState } from './audio/stormEngine'
import { FireEngine, type FireLayers } from './audio/fireEngine'
import { useFireLoop, type FireLoopTick } from './analysis/useFireLoop'
import type { FireFeatures } from './analysis/fireDetector'
import { fireDateLabel, fireDay } from './analysis/fireTimeline'
import { REGION_NAME } from './audio/melody'
import { StrikeOverlay, type StrikeOverlayHandle } from './components/StrikeOverlay'
import { activityLabel, describeFire, describeMoment, hemisphereLabel, sideLabel } from './describe'
import { TRACKS } from './tracks'
import { Gauge, Icon, More, Section, Segmented, Switch } from './ui/controls'
import { useSpring } from './ui/useSpring'
import './App.css'

const EMPTY: FrameFeatures = {
  activity: 0, meanLat: 0, northShare: 0.5, newRate: 0, strikes: [], peakEnergy: 0, isReset: true,
}
const EMPTY_FIRE: FireFeatures = {
  active: 0, front: 0, frontX: -1, frontY: -1, fireX: -1, fireY: -1, burned: 0, growth: 0, recap: false, isReset: true,
}
const PHASE_STORY: Record<string, string> = {
  calma: 'Pocos focos activos. Así empieza todo.',
  creciendo: 'El fuego activo empieza a crecer.',
  intenso: 'El fuego se intensifica y la armonía se tensa.',
  caos: 'El momento más intenso: el crepitar lo llena todo.',
  bajando: 'El fuego activo baja: el incendio se va conteniendo.',
  resumen: 'Resumen final: todo lo que se quemó en 100 días.',
}
const PHASE_TEXT: Record<string, string> = {
  calma: 'Calma', creciendo: 'Creciendo', intenso: 'Intenso', caos: 'Caos', bajando: 'Bajando', resumen: 'Resumen final',
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
  const [trackId, setTrackId] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('pista')
    return TRACKS.some((t) => t.id === q) ? (q as string) : TRACKS[0].id
  })
  const track = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0]
  const isFire = track.kind === 'fire'
  useEffect(() => { document.title = `${track.title} | The Earth Symphony` }, [track.title])
  const storm = useMemo(() => new StormEngine(), [])
  const fire = useMemo(() => new FireEngine(), [])
  // Motor de la pista actual (para lo que comparten las dos pistas: volumen, nivel, diagnóstico…).
  const engine: StormEngine | FireEngine = isFire ? fire : storm
  if (import.meta.env.DEV) Object.assign(window as object, { __engine: engine, __storm: storm, __fire: fire })
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const overlayRef = useRef<StrikeOverlayHandle>(null)
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), [])
  const [diag, setDiag] = useState<(EngineStats & { frameErrors: number; restarts: number; analysisMs: number }) | null>(null)

  const [playing, setPlaying] = useState(false)
  const [layers, setLayers] = useState<LayerState>({ strikes: true, thunder: true, seasons: true })
  const [fireLayers, setFireLayers] = useState<FireLayers>({ fire: true, front: true, burned: true })
  const [volume, setVolume] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [announce, setAnnounce] = useState(true)
  const [videoError, setVideoError] = useState(false)

  const [shown, setShown] = useState({ f: EMPTY, chord: '', notesPerSec: 0, time: 0, duration: 0, level: 0, audio: 'off', balance: null as number | null, last: '' })
  const latest = useRef({ f: EMPTY, chord: '', time: 0, balance: null as number | null, last: '' })
  const notesWindow = useRef<number[]>([])
  const [liveText, setLiveText] = useState('')
  const lastAnnounce = useRef({ key: '', at: 0 })

  useEffect(() => storm.setLayers(layers), [storm, layers])
  useEffect(() => fire.setLayers(fireLayers), [fire, fireLayers])
  useEffect(() => engine.setVolume(volume), [engine, volume])
  useEffect(() => {
    if (video) video.playbackRate = speed
  }, [video, speed])
  useEffect(() => () => { storm.dispose(); fire.dispose() }, [storm, fire])

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

  useLightningLoop(video, storm, onTick, !isFire)

  // --- Incendio ---
  const latestFire = useRef({ f: EMPTY_FIRE, chord: '', phase: 'calma', time: 0 })
  const [shownFire, setShownFire] = useState({ f: EMPTY_FIRE, chord: '', phase: 'calma' })
  const onFireTick = useCallback((t: FireLoopTick) => {
    latestFire.current = { f: t.features, chord: t.chord || latestFire.current.chord, phase: t.chord ? t.phase : latestFire.current.phase, time: t.videoTime }
    if (t.marks.length) overlayRef.current?.addMarks(t.marks)
  }, [])
  useFireLoop(video, fire, onFireTick, isFire)

  // Indicadores (~5 veces por segundo) y anuncios para lector de pantalla.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now()
      notesWindow.current = notesWindow.current.filter((x) => now - x < 1000)
      const { f, chord, balance, last } = latest.current
      const time = isFire ? latestFire.current.time : latest.current.time
      if (isFire) setShownFire({ f: latestFire.current.f, chord: latestFire.current.chord, phase: latestFire.current.phase })
      setShown({
        f, chord, time, balance, last,
        notesPerSec: notesWindow.current.length,
        duration: video?.duration || 0,
        level: engine.getLevel(),
        audio: engine.isStarted ? engine.contextState : 'off',
      })
      if (debug) setDiag({ ...engine.getStats(), ...loopStats })
      if (announce && playing && isFire) {
        const ph = latestFire.current.phase
        if (ph !== lastAnnounce.current.key && now - lastAnnounce.current.at > 6000) {
          lastAnnounce.current = { key: ph, at: now }
          setLiveText(`${PHASE_TEXT[ph] ?? ph}. ${fireDateLabel(fireDay(latestFire.current.time))}.`)
        }
      } else if (announce && playing && f.activity > 0.01) {
        const key = `${activityLabel(f.activity)}|${hemisphereLabel(f.meanLat)}`
        if (key !== lastAnnounce.current.key && now - lastAnnounce.current.at > 8000) {
          lastAnnounce.current = { key, at: now }
          setLiveText(`Actividad ${activityLabel(f.activity)}, tormentas ${hemisphereLabel(f.meanLat)}.`)
        }
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [video, announce, playing, engine, debug, isFire])

  const progressPct = shown.duration ? (shown.time / shown.duration) * 100 : 0

  const startAudio = useCallback(async () => {
    if (isFire) {
      await fire.start()
      fire.setLayers(fireLayers)
    } else {
      await storm.start()
      storm.setLayers(layers)
    }
    engine.setVolume(volume)
  }, [engine, storm, fire, isFire, layers, fireLayers, volume])

  const switchTrack = useCallback((id: string) => {
    if (id === trackId) return
    video?.pause()
    // Al cambiar el video el navegador no siempre avisa la pausa: se marca aquí.
    setPlaying(false)
    storm.silence()
    fire.silence()
    setVideoError(false)
    latest.current = { f: EMPTY, chord: '', time: 0, balance: null, last: '' }
    latestFire.current = { f: EMPTY_FIRE, chord: '', phase: 'calma', time: 0 }
    setTrackId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('pista', id)
    window.history.replaceState(null, '', url)
  }, [trackId, video, storm, fire])

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
    window.setTimeout(() => {
      if (isFire) {
        const { f, phase, time } = latestFire.current
        const day = fireDay(time)
        setLiveText(describeFire({ date: fireDateLabel(day), day, phase: PHASE_TEXT[phase] ?? phase, active: f.active, front: f.front, frontX: f.frontX, burned: f.burned }))
      } else {
        setLiveText(describeMoment(latest.current.f, progressPct, latest.current.balance))
      }
    }, 50)
  }, [progressPct, isFire])

  const testSound = useCallback(async () => {
    await startAudio()
    engine.testSound()
  }, [engine, startAudio])

  const setLayer = useCallback((k: keyof LayerState, v?: boolean) => {
    setLayers((l) => ({ ...l, [k]: v ?? !l[k] }))
  }, [])
  const setFireLayer = useCallback((k: keyof FireLayers, v?: boolean) => {
    setFireLayers((l) => ({ ...l, [k]: v ?? !l[k] }))
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
      } else if (e.key === '1') isFire ? setFireLayer('fire') : setLayer('strikes')
      else if (e.key === '2') isFire ? setFireLayer('front') : setLayer('thunder')
      else if (e.key === '3') isFire ? setFireLayer('burned') : setLayer('seasons')
      else if (e.key.toLowerCase() === 'd') describeNow()
      else if (e.key.toLowerCase() === 'r') restart()
      else if (e.key === 'ArrowRight') seekBy(5)
      else if (e.key === 'ArrowLeft') seekBy(-5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, setLayer, setFireLayer, isFire, describeNow, restart, seekBy])

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
  const ff = shownFire.f
  const fireActiveSpring = useSpring(ff.active, 0.4, reducedMotion)
  const fireFrontSpring = useSpring(ff.front, 0.4, reducedMotion)
  const fireBurnedSpring = useSpring(ff.burned, 0.6, reducedMotion)
  const frontPan = ff.frontX >= 0 ? ff.frontX * (780 / 960) * 2 - 1 : 0
  const frontPanSpring = useSpring(frontPan, 0.35, reducedMotion)
  const day = fireDay(shown.time)

  // Historia: una línea grande sobre el video que cuenta qué está pasando, según lo que se mide.
  const started = playing || shown.time > 0.5
  const story = isFire
    ? {
        kicker: started ? fireDateLabel(day) : '100 días en 100 segundos',
        line: started ? PHASE_STORY[shownFire.phase] ?? '' : 'Pulsa reproducir y escucha cómo nace, crece y se apaga un incendio.',
      }
    : {
        kicker: started && hasData ? `Tormentas ${hemisphereLabel(f.meanLat)}` : 'Seis años de rayos',
        line: started && hasData
          ? `Actividad ${activityLabel(f.activity)}. ${shown.balance === null ? 'Esperando rayos nuevos.' : `Los rayos nuevos suenan ${{ izquierda: 'a la izquierda', derecha: 'a la derecha', centro: 'al centro' }[sideLabel(shown.balance).split(' · ')[0]] ?? ''}.`}`
          : 'Pulsa reproducir y escucha las tormentas del planeta moverse con las estaciones.',
      }

  const audioLabel =
    shown.audio === 'running' ? 'Activo' : shown.audio === 'off' ? 'Apagado' : 'Bloqueado'

  return (
    <div className={`app ${isFire ? 'is-fire' : 'is-storm'}`}>
      <a className="skip" href="#transport">Saltar a los controles</a>

      <section className="stage-full" aria-labelledby="track-title">
        <header className="stage-head">
          <div className="stage-head-text">
            <h1 id="track-title" className="display">{track.title}</h1>
            <p className="lede">{track.subtitle}</p>
          </div>
          <div className="track-picker">
            <Segmented
              label="Pista"
              value={trackId}
              onChange={switchTrack}
              options={TRACKS.map((t) => ({ value: t.id, label: t.short }))}
            />
          </div>
        </header>

          <figure className="viewer">
            <div className="video-wrap" style={{ aspectRatio: String(track.aspect), ['--ar' as string]: track.aspect }}>
              <video
                ref={setVideo}
                src={track.videoSrc}
                muted
                playsInline
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); storm.silence(); fire.silence() }}
                onEnded={() => { setPlaying(false); storm.silence(); fire.silence() }}
                onEmptied={() => setPlaying(false)}
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
              {!isFire && <div className={`lat-rail ${hasData ? 'is-live' : ''}`} aria-hidden="true">
                <span className="lat-rail-line" />
                <span className="lat-rail-eq" />
                <span className="lat-marker" style={{ top: `${latTop}%` }}>
                  <span className="lat-dot" />
                  <span className="lat-pill">{hasData ? formatLat(f.meanLat) : '—'}</span>
                </span>
              </div>}

              {!playing && (
                <button className="hero-play" onClick={() => void togglePlay()} aria-label="Reproducir con sonido">
                  {Icon.play}
                </button>
              )}

              <div className="story" aria-hidden="true">
                <p className="story-kicker">{story.kicker}</p>
                <p className="story-line">{story.line}</p>
              </div>

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
                  aria-label={`Posición en el periodo ${track.periodStart} a ${track.periodEnd}`}
                  aria-valuetext={isFire ? `${fireDateLabel(day)}, día ${Math.round(day)} de 100` : `${Math.round(progressPct)} por ciento del periodo`}
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
            {videoError && (
              <p className="error" role="alert">
                No se encontró el video. Copia el archivo a <code>public{track.videoSrc}</code>.
              </p>
            )}
          </figure>
        <a className="scroll-cue" href="#panel">
          Opciones y métricas
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      </section>

      <main id="panel" className="dash" aria-label="Opciones y métricas">
        <div className="dash-about">
          <h2 className="dash-title">Lo que estás escuchando</h2>
          <More label="Qué muestra el video" id="visual-desc">{track.visualDescription}</More>
        </div>
          {isFire ? (
            <>
              <Section
                className="dash-layers"
                title="Capas de sonido"
                moreLabel="Cómo suena"
                footer="Mismo idioma que las tormentas: lo repentino suena a percusión, lo que avanza a melodía y lo que se acumula a un tono grave. El fuego suena del lado de la pantalla donde está. La armonía se tensa cuando el fuego se intensifica y vuelve a Re menor cuando baja."
              >
                <Switch label="Fuego activo" description="Crepitar; en lo más intenso, un latido grave" shortcut="1" checked={fireLayers.fire} onChange={(v) => setFireLayer('fire', v)} />
                <Switch label="Frente" description="Voz cálida: más frente, más aguda y más notas" shortcut="2" checked={fireLayers.front} onChange={(v) => setFireLayer('front', v)} />
                <Switch label="Área quemada" description="Tono grave que crece durante 100 días" shortcut="3" checked={fireLayers.burned} onChange={(v) => setFireLayer('burned', v)} />
              </Section>

              <Section className="dash-now" title="En este momento">
                <div className="row">
                  <div className="row-text">
                    <span className="row-label">Fecha</span>
                    <span className="row-sub">Día {Math.round(day)} de 100</span>
                  </div>
                  <span className="row-value tabular">{fireDateLabel(day)}</span>
                </div>
                <div className="row">
                  <span className="row-label">Fase</span>
                  <span className="row-value">{playing || shown.time > 0 ? PHASE_TEXT[shownFire.phase] ?? shownFire.phase : '—'}</span>
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Fuego activo</span>
                    <span className="row-value tabular">{Math.round(ff.active * 100)} %</span>
                  </div>
                  <Gauge value={fireActiveSpring} label="Fuego activo" valueText={`${Math.round(ff.active * 100)} por ciento`} />
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Frente</span>
                    <span className="row-value">{ff.front < 0.02 ? 'Sin avance' : frontPan < -0.2 ? 'Izquierda' : frontPan > 0.2 ? 'Derecha' : 'Centro'}</span>
                  </div>
                  <div className="balance" role="meter" aria-label="Lado de la pantalla donde avanza el frente" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={Number(frontPan.toFixed(2))} aria-valuetext={ff.front < 0.02 ? 'sin avance' : frontPan < -0.2 ? 'izquierda' : frontPan > 0.2 ? 'derecha' : 'centro'}>
                    <span className="balance-l">I</span>
                    <span className="balance-track">
                      <span className="balance-mid" />
                      <span className="balance-dot" style={{ left: `${50 + frontPanSpring * 50}%`, opacity: ff.front < 0.02 ? 0.3 : 1 }} />
                    </span>
                    <span className="balance-r">D</span>
                  </div>
                  <Gauge value={fireFrontSpring} label="Avance del frente" valueText={`${Math.round(ff.front * 100)} por ciento`} />
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Área quemada</span>
                    <span className="row-value tabular">{Math.round(ff.burned * 100)} %</span>
                  </div>
                  <Gauge value={fireBurnedSpring} label="Área quemada relativa al total" valueText={`${Math.round(ff.burned * 100)} por ciento del total`} />
                </div>
                <div className="row">
                  <span className="row-label">Acorde</span>
                  <span className="row-value">{shownFire.chord || '—'}</span>
                </div>
              </Section>
            </>
          ) : (
          <>
          <Section
            className="dash-layers"
            title="Capas de sonido"
            moreLabel="Cómo suena"
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

          <Section className="dash-now" title="En este momento">
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
          </>
          )}

          <Section className="dash-play" title="Reproducción">
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

          <Section className="dash-a11y" title="Accesibilidad" moreLabel="Atajos de teclado" footer={<><kbd>Espacio</kbd> reproducir · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> capas · <kbd>D</kbd> describir · <kbd>←</kbd><kbd>→</kbd> ±5 s · <kbd>R</kbd> reiniciar</>}>
            <button className="row row-action" onClick={describeNow} aria-keyshortcuts="D">
              <span className="row-icon">{Icon.describe}</span>Describir este momento
            </button>
            <Switch label="Anunciar cambios" description="Para lectores de pantalla" checked={announce} onChange={setAnnounce} />
          </Section>
          {debug && diag && (
            <Section className="dash-diag" title="Diagnóstico" footer="Visible solo con ?debug en la dirección. Errores debe quedarse en 0 y los reinicios del bucle no deben subir.">
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
      </main>

      <footer className="foot">
        Datos visuales: <a href={track.source.url} target="_blank" rel="noreferrer">{track.source.label}</a>, NASA
        Scientific Visualization Studio. {track.dataNote}
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
