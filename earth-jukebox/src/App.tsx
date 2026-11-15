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
import { HELP_APP, type Command, type LayerName } from './voice/commands'
import { useVoiceHandler } from './voice/VoiceProvider'
import { audioHealth, setSoundExpected } from './audio/toneContext'
import { VoiceButton } from './voice/VoiceButton'
import './App.css'

const EMPTY: FrameFeatures = {
  activity: 0, meanLat: 0, northShare: 0.5, newRate: 0, strikes: [], peakEnergy: 0, isReset: true,
}
const EMPTY_FIRE: FireFeatures = {
  active: 0, front: 0, frontX: -1, frontY: -1, fireX: -1, fireY: -1, burned: 0, growth: 0, recap: false, isReset: true,
}
const PHASE_STORY: Record<string, string> = {
  calma: 'A few hot spots. This is how it all begins.',
  creciendo: 'The active fire starts to grow.',
  intenso: 'The fire intensifies and the harmony tightens.',
  caos: 'The most intense moment: the crackling fills everything.',
  bajando: 'The active fire drops: the blaze is being contained.',
  resumen: 'Final recap: everything that burned in 100 days.',
}
const LEVEL_TEXT: Record<string, string> = { chico: 'small', mediano: 'medium', grande: 'large', 'muy grande': 'very large' }
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const PHASE_TEXT: Record<string, string> = {
  calma: 'Calm', creciendo: 'Growing', intenso: 'Intense', caos: 'Chaos', bajando: 'Easing', resumen: 'Final recap',
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
  // El vigilante del audio necesita saber cuándo debería oírse algo.
  const expectRef = useRef(false)
  useEffect(() => {
    expectRef.current = playing && (track.kind === 'fire' ? Object.values(fireLayers).some(Boolean) : Object.values(layers).some(Boolean))
  })
  useEffect(() => {
    setSoundExpected(() => expectRef.current)
    return () => setSoundExpected(() => false)
  }, [])
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
      const kind = p.voices === 3 ? 'arpeggio' : p.voices === 2 ? 'two notes' : 'one note'
      last = `${REGION_NAME[p.region]} · ${LEVEL_TEXT[p.level] ?? p.level} · ${p.land ? 'land' : 'ocean'} · ${kind}${arrow}${p.isNew ? ' · new' : ''}`
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
          setLiveText(`${capitalize(activityLabel(f.activity))} activity, storms ${hemisphereLabel(f.meanLat)}.`)
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

  const momentText = useCallback(() => {
    if (isFire) {
      const { f, phase, time } = latestFire.current
      const day = fireDay(time)
      return describeFire({ date: fireDateLabel(day), day, phase: PHASE_TEXT[phase] ?? phase, active: f.active, front: f.front, frontX: f.frontX, burned: f.burned })
    }
    return describeMoment(latest.current.f, progressPct, latest.current.balance)
  }, [progressPct, isFire])

  const describeNow = useCallback(() => {
    setLiveText('')
    window.setTimeout(() => setLiveText(momentText()), 50)
  }, [momentText])

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

  // Comandos de voz: cada uno responde con una frase corta que se dice en voz alta.
  const onVoice = async (cmd: Command): Promise<string | null> => {
    switch (cmd.type) {
      case 'play':
      case 'resume': {
        if (!video) return null
        if (!video.paused) return 'It is already playing.'
        await togglePlay()
        if (engine.contextState !== 'running') return 'The browser blocked the sound. Tap the screen or press any key once.'
        return cmd.type === 'play' ? 'Playing.' : 'Resuming.'
      }
      case 'pause':
        if (!video || video.paused) return 'It is already paused.'
        video.pause()
        return 'Paused.'
      case 'restart':
        restart()
        return video?.paused ? 'Back to the beginning. Say play to listen.' : 'From the beginning.'
      case 'seek':
        seekBy(cmd.seconds)
        return `${cmd.seconds > 0 ? 'Skipped forward' : 'Went back'} ${Math.abs(cmd.seconds)} seconds.`
      case 'goto': {
        if (cmd.target === 'inicio') return null // la página de inicio la abre el nivel superior
        if (cmd.target === trackId) return `You are already in ${track.title}.`
        switchTrack(cmd.target)
        const next = TRACKS.find((t) => t.id === cmd.target)
        return `Opening ${next?.title ?? cmd.target}. Say play to listen.`
      }
      case 'volume': {
        const next = Math.max(-30, Math.min(0, volume + cmd.dir * 6))
        if (next === volume) return cmd.dir > 0 ? 'Volume is already at maximum.' : 'Volume is already at minimum.'
        setVolume(next)
        return cmd.dir > 0 ? 'Louder.' : 'Quieter.'
      }
      case 'speed':
        setSpeed(cmd.value)
        return cmd.value === 0.5 ? 'Half speed.' : 'Normal speed.'
      case 'layer': {
        const names: Record<LayerName, string> = { rayos: 'lightning', truenos: 'thunder', estaciones: 'seasons', fuego: 'active fire', frente: 'fire front', quemada: 'burned area' }
        const stormKey = ({ rayos: 'strikes', truenos: 'thunder', estaciones: 'seasons' } as Partial<Record<LayerName, keyof LayerState>>)[cmd.layer]
        const fireKey = ({ fuego: 'fire', frente: 'front', quemada: 'burned' } as Partial<Record<LayerName, keyof FireLayers>>)[cmd.layer]
        if (isFire && fireKey) setFireLayer(fireKey, cmd.on)
        else if (!isFire && stormKey) setLayer(stormKey, cmd.on)
        else return 'That layer belongs to the other simulation.'
        return `${names[cmd.layer][0].toUpperCase()}${names[cmd.layer].slice(1)} ${cmd.on ? 'on' : 'off'}.`
      }
      case 'describe':
        return momentText()
      case 'tour':
        return 'That works on the home page. Say: take me home.'
      case 'help':
        return HELP_APP
      default:
        return null
    }
  }
  useVoiceHandler(onVoice, !!video)

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
        kicker: started ? fireDateLabel(day) : '100 days in 100 seconds',
        line: started ? PHASE_STORY[shownFire.phase] ?? '' : 'Press play and hear a wildfire start, grow and die out.',
      }
    : {
        kicker: started && hasData ? `Storms ${hemisphereLabel(f.meanLat)}` : 'Six years of lightning',
        line: started && hasData
          ? `${capitalize(activityLabel(f.activity))} activity. ${shown.balance === null ? 'Waiting for new lightning.' : `New lightning sounds ${{ left: 'on the left', right: 'on the right', center: 'in the center' }[sideLabel(shown.balance).split(' · ')[0]] ?? ''}.`}`
          : 'Press play and hear the planet’s storms move with the seasons.',
      }

  const audioLabel =
    shown.audio === 'running' ? 'On' : shown.audio === 'off' ? 'Off' : 'Blocked'

  return (
    <div className={`app ${isFire ? 'is-fire' : 'is-storm'}`}>
      <a className="skip" href="#transport">Skip to controls</a>

      <section className="stage-full" aria-labelledby="track-title">
        <header className="stage-head">
          <div className="stage-head-text">
            <h1 id="track-title" className="display">{track.title}</h1>
            <p className="lede">{track.subtitle}</p>
          </div>
          <div className="stage-head-actions">
            <div className="track-picker">
              <Segmented
                label="Track"
                value={trackId}
                onChange={switchTrack}
                options={TRACKS.map((t) => ({ value: t.id, label: t.short }))}
              />
            </div>
            <VoiceButton />
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
                <span className="pan-tag left">Left</span>
                <span className="pan-tag right">Right</span>
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
                <button className="hero-play" onClick={() => void togglePlay()} aria-label="Play with sound">
                  {Icon.play}
                </button>
              )}

              <div className="story" aria-hidden="true">
                <p className="story-kicker">{story.kicker}</p>
                <p className="story-line">{story.line}</p>
              </div>

              {/* Capa funcional: única superficie de vidrio, flotando sobre el contenido */}
              <div id="transport" className="transport glass" role="group" aria-label="Playback">
                <button
                  className="t-btn t-primary"
                  onClick={() => void togglePlay()}
                  aria-label={playing ? 'Pause' : 'Play'}
                  aria-keyshortcuts="Space"
                >
                  {playing ? Icon.pause : Icon.play}
                </button>
                <button className="t-btn" onClick={restart} aria-label="Restart" aria-keyshortcuts="R">
                  {Icon.restart}
                </button>
                <input
                  className="scrubber"
                  type="range"
                  min={0}
                  max={shown.duration || 100}
                  step={0.1}
                  value={shown.time}
                  style={{ ['--p' as string]: `${progressPct}%` }}
                  onChange={(e) => { if (video) video.currentTime = Number(e.target.value) }}
                  aria-label={`Position in the period ${track.periodStart} to ${track.periodEnd}`}
                  aria-valuetext={isFire ? `${fireDateLabel(day)}, day ${Math.round(day)} of 100` : `${Math.round(progressPct)} percent of the period`}
                />
                <span className="t-vol">
                  {Icon.speaker}
                  <input
                    className="scrubber vol"
                    type="range" min={-30} max={0} step={1} value={volume}
                    style={{ ['--p' as string]: `${((volume + 30) / 30) * 100}%` }}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                    aria-valuetext={`${volume} decibels`}
                  />
                </span>
              </div>
            </div>
            {videoError && (
              <p className="error" role="alert">
                Video not found. Copy the file to <code>public{track.videoSrc}</code>.
              </p>
            )}
          </figure>
        <a className="scroll-cue" href="#panel">
          Options and metrics
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      </section>

      <main id="panel" className="dash" aria-label="Options and metrics">
        <div className="dash-about">
          <h2 className="dash-title">What you are hearing</h2>
          <More label="What the video shows" id="visual-desc">{track.visualDescription}</More>
        </div>
          {isFire ? (
            <>
              <Section
                className="dash-layers"
                title="Sound layers"
                moreLabel="How it sounds"
                footer="Same language as the storms: sudden things sound like percussion, what advances is melody, and what accumulates is a low drone. The fire sounds on the side of the screen where it is. The harmony tightens when the fire intensifies and returns to D minor when it eases."
              >
                <Switch label="Active fire" description="Crackling; at its most intense, a low heartbeat" shortcut="1" checked={fireLayers.fire} onChange={(v) => setFireLayer('fire', v)} />
                <Switch label="Fire front" description="Warm voice: the bigger the front, the higher and busier it gets" shortcut="2" checked={fireLayers.front} onChange={(v) => setFireLayer('front', v)} />
                <Switch label="Burned area" description="Low drone that grows over 100 days" shortcut="3" checked={fireLayers.burned} onChange={(v) => setFireLayer('burned', v)} />
              </Section>

              <Section className="dash-now" title="Right now">
                <div className="row">
                  <div className="row-text">
                    <span className="row-label">Date</span>
                    <span className="row-sub">Day {Math.round(day)} of 100</span>
                  </div>
                  <span className="row-value tabular">{fireDateLabel(day)}</span>
                </div>
                <div className="row">
                  <span className="row-label">Phase</span>
                  <span className="row-value">{playing || shown.time > 0 ? PHASE_TEXT[shownFire.phase] ?? shownFire.phase : '—'}</span>
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Active fire</span>
                    <span className="row-value tabular">{Math.round(ff.active * 100)} %</span>
                  </div>
                  <Gauge value={fireActiveSpring} label="Active fire" valueText={`${Math.round(ff.active * 100)} percent`} />
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Fire front</span>
                    <span className="row-value">{ff.front < 0.02 ? 'Not advancing' : frontPan < -0.2 ? 'Left' : frontPan > 0.2 ? 'Right' : 'Center'}</span>
                  </div>
                  <div className="balance" role="meter" aria-label="Side of the screen where the fire front advances" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={Number(frontPan.toFixed(2))} aria-valuetext={ff.front < 0.02 ? 'not advancing' : frontPan < -0.2 ? 'left' : frontPan > 0.2 ? 'right' : 'center'}>
                    <span className="balance-l">L</span>
                    <span className="balance-track">
                      <span className="balance-mid" />
                      <span className="balance-dot" style={{ left: `${50 + frontPanSpring * 50}%`, opacity: ff.front < 0.02 ? 0.3 : 1 }} />
                    </span>
                    <span className="balance-r">R</span>
                  </div>
                  <Gauge value={fireFrontSpring} label="Fire front advance" valueText={`${Math.round(ff.front * 100)} percent`} />
                </div>
                <div className="row stack">
                  <div className="row-head">
                    <span className="row-label">Burned area</span>
                    <span className="row-value tabular">{Math.round(ff.burned * 100)} %</span>
                  </div>
                  <Gauge value={fireBurnedSpring} label="Burned area relative to the total" valueText={`${Math.round(ff.burned * 100)} percent of the total`} />
                </div>
                <div className="row">
                  <span className="row-label">Chord</span>
                  <span className="row-value">{shownFire.chord || '—'}</span>
                </div>
              </Section>
            </>
          ) : (
          <>
          <Section
            className="dash-layers"
            title="Sound layers"
            moreLabel="How it sounds"
            footer="Each region has its own voice: the Americas low (left), Europe and Africa in the middle (center), Asia and Oceania high (right), and they answer each other. The melody rises when storms move north. A growing storm arpeggiates upward; a shrinking one, downward. Over land you hear a soft electric piano, and over the ocean a vibraphone."
          >
            <Switch
              label="Lightning" description="Large groups play the melody; small ones, high sparkles" shortcut="1"
              checked={layers.strikes} onChange={(v) => setLayer('strikes', v)}
            />
            <Switch
              label="Thunder" description="Very large groups rumble on the chord’s root" shortcut="2"
              checked={layers.thunder} onChange={(v) => setLayer('thunder', v)}
            />
            <Switch
              label="Seasons" description="Background chord; the melody uses its notes" shortcut="3"
              checked={layers.seasons} onChange={(v) => setLayer('seasons', v)}
            />
          </Section>

          <Section className="dash-now" title="En este momento">
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Activity</span>
                <span className="row-value">{hasData ? activityLabel(f.activity) : '—'}</span>
              </div>
              <Gauge value={activitySpring} label="Activity over the last 10 days" valueText={activityLabel(f.activity)} />
            </div>
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">New lightning</span>
                <span className="row-value tabular">{shown.notesPerSec} groups/s</span>
              </div>
              <Gauge value={newSpring} label="New lightning intensity" valueText={`${shown.notesPerSec} large groups per second`} />
            </div>
            <div className="row stack">
              <div className="row-head">
                <span className="row-label">Headphones</span>
                <span className="row-value">{playing ? sideLabel(shown.balance) : '—'}</span>
              </div>
              <div
                className="balance"
                role="meter"
                aria-label="Left-right balance of new lightning"
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={Number((shown.balance ?? 0).toFixed(2))}
                aria-valuetext={sideLabel(shown.balance)}
              >
                <span className="balance-l">L</span>
                <span className="balance-track">
                  <span className="balance-mid" />
                  <span className="balance-dot" style={{ left: `${50 + balanceSpring * 50}%` }} />
                </span>
                <span className="balance-r">R</span>
              </div>
            </div>
            <div className="row">
              <div className="row-text">
                <span className="row-label">Storm center</span>
                <span className="row-sub">{hasData ? hemisphereLabel(f.meanLat) : 'No data yet'}</span>
              </div>
              <span className="row-value tabular">{hasData ? formatLat(f.meanLat) : '—'}</span>
            </div>
            <div className="row">
              <div className="row-text">
                <span className="row-label">Last large group</span>
                <span className="row-sub">{shown.last || 'Waiting…'}</span>
              </div>
            </div>
            <div className="row">
              <span className="row-label">Chord</span>
              <span className="row-value">{shown.chord || '—'}</span>
            </div>
          </Section>
          </>
          )}

          <Section className="dash-play" title="Playback">
            <div className="row">
              <span className="row-label">Speed</span>
              <Segmented
                label="Speed"
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
              <Gauge value={levelSpring} label="Audio output level" valueText={audioLabel} />
            </div>
            <button className="row row-action" onClick={() => void testSound()}>
              <span className="row-icon">{Icon.wave}</span>Test sound
            </button>
          </Section>

          <Section className="dash-a11y" title="Accessibility" moreLabel="Keyboard shortcuts" footer={<><kbd>Space</kbd> play · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> layers · <kbd>D</kbd> describe · <kbd>←</kbd><kbd>→</kbd> ±5 s · <kbd>R</kbd> restart · <kbd>V</kbd> voice commands</>}>
            <button className="row row-action" onClick={describeNow} aria-keyshortcuts="D">
              <span className="row-icon">{Icon.describe}</span>Describe this moment
            </button>
            <Switch label="Announce changes" description="For screen readers" checked={announce} onChange={setAnnounce} />
          </Section>
          {debug && diag && (
            <Section className="dash-diag" title="Diagnostics" footer="Only visible with ?debug in the URL. Errors should stay at 0 and loop restarts should not go up.">
              <DiagRow label="Notes per second" value={`${diag.notesPerSec}`} />
              <DiagRow label="Notes dropped by saturation" value={`${diag.dropped} of ${diag.dropped + diag.admitted}`} />
              <DiagRow label="Errors" value={`${diag.errors}`} />
              {diag.lastError && <DiagRow label="Last error" value={diag.lastError} />}
              <DiagRow label="Loop restarts" value={`${diag.restarts}`} />
              <DiagRow label="Audio resumes" value={`${diag.resumes}`} />
              <DiagRow label="Audio output restarts" value={`${audioHealth.recoveries}${audioHealth.lastReason ? ` (${audioHealth.lastReason})` : ''}`} />
              <DiagRow label="Analysis per frame" value={`${diag.analysisMs.toFixed(1)} ms`} />
              <DiagRow label="Audio context" value={diag.context} />
            </Section>
          )}
      </main>

      <footer className="foot">
        Visual data: <a href={track.source.url} target="_blank" rel="noreferrer">{track.source.label}</a>, NASA
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
