import * as Tone from 'tone'
import type { FireFeatures } from '../analysis/fireDetector'
import { NoteBudget, densityGain, pickVoice, rankOf, safeStart } from './budget'
import {
  FIRE_CHORDS, FIRE_SLOT, FRONT_RANGE, crackleCount, fireBass, fireChordFor, fireIntensity,
  fireLadder, firePhase, frontAllows, heartbeat, nextFrontIndex, screenToPan, type FirePhase,
} from './fireMusic'
import { midiToNote } from './harmony'
import type { EngineStats } from './stormEngine'

/**
 * Motor de sonido "Incendio Dixie 2021".
 *
 *  FUEGO ACTIVO (rojo)   crepitar (ruido corto filtrado) en el pulso, 0–3 por tiempo según la
 *                        cantidad de fuego; en lo más intenso, un latido grave en la nota del acorde.
 *                        Suena del lado de la pantalla donde está el fuego.
 *  FRENTE (amarillo)     voz cálida que camina por las notas del acorde: más frente = más agudo
 *                        y más notas por tiempo. Suena del lado donde avanza el frente.
 *  ÁREA QUEMADA (gris)   PRESENCIA: un sub-bajo continuo (37–58 Hz, la nota base del acorde)
 *                        cuyo volumen sigue la curva de km² de la gráfica del video. Tiene
 *                        armónicos 2.º y 3.º para que se perciba también en bocinas pequeñas
 *                        que no reproducen esas frecuencias. "Respira" más hondo y más rápido
 *                        cuando el área crece rápido (p. ej. 4–6 de agosto). Encima, un colchón
 *                        grave que se abre conforme crece el área.
 *  RESUMEN FINAL         al aparecer el resumen del video, todo se apaga y suena un cierre lento.
 *
 * Armonía según la intensidad (fireMusic.ts). Mismas protecciones que los rayos (budget.ts).
 */

export interface FireLayers {
  fire: boolean
  front: boolean
  burned: boolean
}

export interface FireMark {
  x: number
  y: number
  kind: 'fuego' | 'frente'
}

export interface FireTick {
  marks: FireMark[]
  chord: string
  phase: FirePhase
  intensity: number
}

type Voice<T> = { synth: T; panner: Tone.Panner; busyUntil: number; lastStart: number }

const LOOKAHEAD = 0.12
const MAX_SLOTS_PER_UPDATE = 8
/** Lado de la pantalla → la x del mapa ocupa el 81 % izquierdo del video (el resto es la gráfica). */
const MAP_FRACTION = 780 / 960

/** Respiración del sub-bajo: una vez cada ~7 s en calma, ~1.5 por segundo en el avance más rápido. */
const SUB_BREATH_REST = 0.14
const SUB_BREATH_FAST = 1.5

/** Nota base del acorde en el registro de sub-bajo: Re1 (36.7 Hz) … Do#2 (69 Hz). */
export function subFreq(chord: number): number {
  const b = fireBass(Math.max(0, chord)) // Do2..Si2
  const midi = 26 + ((b - 26) % 12 + 12) % 12 // Re1..Do#2
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Volumen (lineal) del sub-bajo según la fracción del área final. 0 sin área. */
export function subGain(area: number): number {
  if (area <= 0.002) return 0
  return Math.min(1, Math.pow(area, 0.55))
}

export class FireEngine {
  private started = false
  private master!: Tone.Volume
  private meter!: Tone.Meter
  private fireBus!: Tone.Volume
  private frontBus!: Tone.Volume
  private burnedBus!: Tone.Volume
  private crackles: Voice<Tone.NoiseSynth>[] = []
  private voices: Voice<Tone.Synth>[] = []
  private bells: Voice<Tone.FMSynth>[] = []
  private drum!: Tone.MembraneSynth
  private drumLast = 0
  private drone!: Tone.PolySynth
  private droneFilter!: Tone.Filter
  private droneTremolo!: Tone.Tremolo
  private sub!: Tone.Oscillator
  private subLevel!: Tone.Gain
  private subBreath!: Tone.Tremolo
  private subBus!: Tone.Volume
  private subOn = false
  private layers: FireLayers = { fire: true, front: true, burned: true }

  private budget = new NoteBudget()
  private nextSlot = -1
  private chord = -1
  private droneChord = -1
  private frontIdx = -1
  private intensity = 0
  private trend = 0
  private codaPlayed = false
  private last: FireFeatures | null = null
  private errors = 0
  private lastError = ''
  private resumes = 0

  get isStarted() {
    return this.started
  }
  get contextState(): string {
    return Tone.getContext().state
  }
  getLevel(): number {
    if (!this.started) return 0
    const v = this.meter.getValue()
    return typeof v === 'number' ? v : Math.max(...v)
  }
  getStats(): EngineStats {
    const now = this.started ? Tone.now() : 0
    return {
      notesPerSec: this.budget.recent(now),
      dropped: this.budget.dropped,
      admitted: this.budget.admitted,
      errors: this.errors,
      lastError: this.lastError,
      resumes: this.resumes,
      context: this.started ? Tone.getContext().state : 'off',
    }
  }
  noteError(e: unknown) {
    this.errors++
    this.lastError = e instanceof Error ? e.message : String(e)
    if (import.meta.env.DEV) console.warn('[FireEngine]', this.lastError)
  }

  async start(): Promise<void> {
    if (this.started) return
    await Tone.start()
    const limiter = new Tone.Limiter(-1).toDestination()
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.25, knee: 8 }).connect(limiter)
    this.master = new Tone.Volume(0).connect(compressor)
    this.meter = new Tone.Meter({ normalRange: true, smoothing: 0.6, channelCount: 2 })
    limiter.connect(this.meter)
    // Sala más oscura y larga que la de los rayos.
    const reverb = new Tone.Reverb({ decay: 5.5, preDelay: 0.04, wet: 0.32 }).connect(this.master)

    // --- Fuego activo: crepitar + latido ---
    this.fireBus = new Tone.Volume(5).connect(reverb)
    const crackleFilter = new Tone.Filter({ type: 'bandpass', frequency: 2800, Q: 0.9 }).connect(this.fireBus)
    for (let i = 0; i < 6; i++) {
      const panner = new Tone.Panner(0).connect(crackleFilter)
      const synth = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.03 },
        volume: -3,
      }).connect(panner)
      this.crackles.push({ synth, panner, busyUntil: 0, lastStart: 0 })
    }
    this.drum = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 2,
      envelope: { attack: 0.005, decay: 0.7, sustain: 0, release: 0.5 },
      volume: -2,
    }).connect(new Tone.Filter({ type: 'lowpass', frequency: 400 }).connect(this.fireBus))

    // --- Frente: voz cálida (dos sierras ligeramente desafinadas, filtradas) ---
    this.frontBus = new Tone.Volume(5).connect(reverb)
    const frontFilter = new Tone.Filter({ type: 'lowpass', frequency: 1500, Q: 0.7 }).connect(this.frontBus)
    for (let i = 0; i < 10; i++) {
      const panner = new Tone.Panner(0).connect(frontFilter)
      const synth = new Tone.Synth({
        oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
        envelope: { attack: 0.04, decay: 0.35, sustain: 0.3, release: 0.9 },
        volume: -6,
      }).connect(panner)
      this.voices.push({ synth, panner, busyUntil: 0, lastStart: 0 })
    }
    // Campanas para el cierre.
    for (let i = 0; i < 6; i++) {
      const panner = new Tone.Panner(0).connect(this.frontBus)
      const synth = new Tone.FMSynth({
        harmonicity: 4, modulationIndex: 0.9,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.01, decay: 3, sustain: 0, release: 2.5 },
        modulationEnvelope: { attack: 0.004, decay: 0.3, sustain: 0, release: 0.3 },
        volume: 2,
      }).connect(panner)
      this.bells.push({ synth, panner, busyUntil: 0, lastStart: 0 })
    }

    // --- Área quemada: colchón grave ---
    this.burnedBus = new Tone.Volume(-4).connect(reverb)
    this.droneTremolo = new Tone.Tremolo({ frequency: 1.4, depth: 0, spread: 0 }).connect(this.burnedBus).start()
    this.droneFilter = new Tone.Filter({ type: 'lowpass', frequency: 220, Q: 0.6 }).connect(this.droneTremolo)
    this.drone = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fattriangle', count: 3, spread: 16 },
      envelope: { attack: 3, decay: 0.5, sustain: 0.9, release: 4 },
      volume: -9,
    }).connect(this.droneFilter)

    // --- Área quemada: presencia (sub-bajo) ---
    // Va directo al master, sin reverb: un grave con eco se vuelve lodo.
    this.subBus = new Tone.Volume(-11).connect(this.master)
    this.subBreath = new Tone.Tremolo({ frequency: SUB_BREATH_REST, depth: 0.15, spread: 0, type: 'sine' })
      .connect(this.subBus).start()
    const subFilter = new Tone.Filter({ type: 'lowpass', frequency: 190, Q: 0.5, rolloff: -24 }).connect(this.subBreath)
    this.subLevel = new Tone.Gain(0).connect(subFilter)
    this.sub = new Tone.Oscillator({ frequency: subFreq(0), type: 'custom', partials: [1, 0.4, 0.15] }).connect(this.subLevel)

    this.started = true
    this.applyLayers()
  }

  setLayers(l: FireLayers) {
    this.layers = l
    if (this.started) this.applyLayers()
  }
  private applyLayers() {
    this.fireBus.mute = !this.layers.fire
    this.frontBus.mute = !this.layers.front
    this.burnedBus.mute = !this.layers.burned
    this.subBus.mute = !this.layers.burned
  }
  setVolume(db: number) {
    if (this.started) this.master.volume.rampTo(db, 0.1)
  }

  /** Crepitar a la izquierda, voz a la derecha, latido al centro. */
  testSound() {
    if (!this.started) return
    const now = Tone.now() + 0.05
    for (let k = 0; k < 5; k++) this.playCrackle(-1, now + k * 0.06, 0.8)
    this.playFront(69, 1, now + 0.45, 0.9, 0.6)
    this.playDrum('D1', 0, now + 1.1)
  }

  silence() {
    if (!this.started) return
    this.subLevel.gain.rampTo(0, 0.4)
    this.drone.releaseAll()
    this.droneChord = -1
    this.nextSlot = -1
    this.frontIdx = -1
  }

  dispose() {
    if (!this.started) return
    this.drone.releaseAll()
    this.subLevel.gain.rampTo(0, 0.2)
  }

  private ensureRunning() {
    const ctx = Tone.getContext()
    if (ctx.state !== 'running') {
      this.resumes++
      void ctx.resume().catch(() => {})
    }
  }

  update(f: FireFeatures, dt: number): FireTick {
    const empty: FireTick = { marks: [], chord: '', phase: 'calma', intensity: 0 }
    if (!this.started) return empty
    try {
      this.ensureRunning()
      return this.updateUnsafe(f, dt)
    } catch (e) {
      this.noteError(e)
      this.nextSlot = -1
      return empty
    }
  }

  private updateUnsafe(f: FireFeatures, dt: number): FireTick {
    const now = Tone.now()
    if (f.isReset) {
      this.nextSlot = -1
      this.frontIdx = -1
      if (!f.recap) this.codaPlayed = false
    }
    this.last = f

    // Intensidad suavizada (~1.5 s) y su tendencia. Tras un salto, parte del valor actual.
    const raw = fireIntensity(f.active, f.front)
    if (f.isReset) {
      this.intensity = raw
      this.trend = 0
    }
    const prev = this.intensity
    const k = Math.min(1, dt / 1.5)
    this.intensity = prev + (raw - prev) * k
    this.trend = this.trend * 0.9 + ((this.intensity - prev) / Math.max(dt, 1 / 60)) * 0.1

    // Resumen final: se apaga todo y suena el cierre una sola vez.
    if (f.recap) {
      if (!this.codaPlayed) {
        this.codaPlayed = true
        this.drone.releaseAll(now)
        this.droneChord = -1
        this.playCoda(now + 0.1)
        // La presencia del área final se queda unos segundos y se desvanece.
        this.updateSub(1, 0, 0, 8)
      }
      return { marks: [], chord: 'D minor', phase: 'resumen', intensity: 0 }
    }

    this.chord = fireChordFor(this.intensity, this.chord)

    // Colchón grave: nota base del acorde; se abre y sube con el área quemada; late mientras crece.
    if (this.chord !== this.droneChord) {
      if (this.droneChord >= 0) this.drone.releaseAll(now)
      const b = fireBass(this.chord)
      this.drone.triggerAttack([midiToNote(b), midiToNote(b + 7), midiToNote(b + 12)], now + 0.05, 0.6)
      this.droneChord = this.chord
    }
    this.droneFilter.frequency.rampTo(160 + f.burned * 900, 0.6)
    this.burnedBus.volume.rampTo(-14 + f.burned * 12, 0.6)
    this.droneTremolo.depth.rampTo(Math.min(0.5, f.growth * 0.6), 0.6)
    this.updateSub(f.burned, f.growth, this.chord)

    // Pulso
    // Después de una trabada, los tiempos que ya pasaron se saltan (no se tocan todos juntos: "palomitas").
    const earliest = Tone.getContext().currentTime + 0.03
    if (this.nextSlot < 0 || this.nextSlot < earliest) this.nextSlot = Math.ceil(Math.max(now - FIRE_SLOT, earliest) / FIRE_SLOT) * FIRE_SLOT
    const marks: FireMark[] = []
    let n = 0
    while (this.nextSlot < now + LOOKAHEAD && n++ < MAX_SLOTS_PER_UPDATE) {
      marks.push(...this.flushSlot(this.nextSlot, f))
      this.nextSlot += FIRE_SLOT
    }
    if (this.nextSlot < now) this.nextSlot = Math.ceil(now / FIRE_SLOT) * FIRE_SLOT

    return {
      marks,
      chord: FIRE_CHORDS[this.chord].name,
      phase: firePhase(this.intensity, this.trend, false),
      intensity: this.intensity,
    }
  }

  private flushSlot(t: number, f: FireFeatures): FireMark[] {
    const marks: FireMark[] = []
    const sub = Math.round(t / FIRE_SLOT) % 4
    type Item = { rank: number; time: number; play: (g: number) => void }
    const items: Item[] = []

    // Frente → melodía
    if (frontAllows(sub, f.front)) {
      const ladder = fireLadder(this.chord, FRONT_RANGE[0], FRONT_RANGE[1])
      this.frontIdx = nextFrontIndex(f.front, ladder.length, Math.min(this.frontIdx, ladder.length - 1))
      const midi = ladder[this.frontIdx]
      const pan = f.frontX >= 0 ? screenToPan(f.frontX * MAP_FRACTION) : 0
      const vel = 0.45 + Math.min(1, f.front * 1.5) * 0.45
      const dur = sub === 0 ? FIRE_SLOT * 3.5 : FIRE_SLOT * 1.6
      items.push({ rank: rankOf('lider'), time: t, play: (g) => this.playFront(midi, pan, t, vel * g, dur) })
      if (f.frontX >= 0) marks.push({ x: f.frontX * MAP_FRACTION, y: f.frontY, kind: 'frente' })
    }

    // Fuego activo → crepitar y latido
    const c = crackleCount(sub, f.active)
    const cpan = f.fireX >= 0 ? screenToPan(f.fireX * MAP_FRACTION) : 0
    for (let i = 0; i < c; i++) {
      const tk = t + (i * FIRE_SLOT) / Math.max(c, 1) + Math.random() * 0.02
      const v = 0.35 + Math.random() * 0.4 * (0.5 + f.active)
      items.push({ rank: rankOf('destello'), time: tk, play: (g) => this.playCrackle(cpan, tk, v * g) })
    }
    if (heartbeat(sub, f.active)) {
      const note = midiToNote(fireBass(this.chord) - 12)
      items.push({ rank: rankOf('acompanante'), time: t, play: () => this.playDrum(note, cpan * 0.5, t) })
      if (f.fireX >= 0) marks.push({ x: f.fireX * MAP_FRACTION, y: f.fireY, kind: 'fuego' })
    }

    items.sort((a, b) => b.rank - a.rank)
    const gain = densityGain(this.budget.recent(t))
    for (const it of items) {
      if (!this.budget.admit(it.time, it.rank)) continue
      try {
        it.play(gain)
      } catch (e) {
        this.noteError(e)
      }
    }
    return marks
  }

  private playFront(midi: number, pan: number, time: number, vel: number, dur: number) {
    const i = pickVoice(this.voices.map((v) => v.busyUntil), time)
    const v = this.voices[i]
    const start = safeStart(time, v.lastStart, Tone.getContext().currentTime)
    v.panner.pan.setValueAtTime(pan, start)
    v.synth.triggerAttackRelease(midiToNote(midi), dur, start, vel)
    v.lastStart = start
    v.busyUntil = start + dur + 0.9
  }

  private playCrackle(pan: number, time: number, vel: number) {
    const i = pickVoice(this.crackles.map((v) => v.busyUntil), time)
    const v = this.crackles[i]
    const start = safeStart(time, v.lastStart, Tone.getContext().currentTime)
    v.panner.pan.setValueAtTime(pan, start)
    v.synth.triggerAttackRelease(0.03, start, vel)
    v.lastStart = start
    v.busyUntil = start + 0.08
  }

  private playDrum(note: string, pan: number, time: number) {
    void pan
    const start = safeStart(time, this.drumLast, Tone.getContext().currentTime)
    this.drum.triggerAttackRelease(note, 0.6, start, 0.8)
    this.drumLast = start
  }

  /**
   * Presencia del área quemada: volumen según la fracción del área final (con curva para que
   * el primer tramo ya se sienta), respiración según qué tan rápido crece.
   * fadeTo (segundos) apaga la presencia lentamente en el cierre.
   */
  private updateSub(area: number, growth: number, chord: number, fadeTo = 0) {
    if (!this.subOn) {
      this.sub.start()
      this.subOn = true
    }
    if (fadeTo > 0) {
      this.subLevel.gain.rampTo(0, fadeTo)
      this.subBreath.depth.rampTo(0.1, 1)
      this.subBreath.frequency.rampTo(SUB_BREATH_REST, 1)
      return
    }
    this.sub.frequency.rampTo(subFreq(chord), 1.2)
    this.subLevel.gain.rampTo(subGain(area), 0.8)
    this.subBreath.depth.rampTo(0.15 + growth * 0.55, 0.8)
    this.subBreath.frequency.rampTo(SUB_BREATH_REST + growth * (SUB_BREATH_FAST - SUB_BREATH_REST), 0.8)
  }

  /** Cierre: arpegio lento de Re menor en campanas, de izquierda a derecha, y el colchón final. */
  private playCoda(t: number) {
    const notes = [62, 65, 69, 74, 76, 74]
    notes.forEach((m, i) => {
      const v = this.bells[i % this.bells.length]
      const start = safeStart(t + i * 0.55, v.lastStart, Tone.getContext().currentTime)
      v.panner.pan.setValueAtTime(-0.8 + (i / (notes.length - 1)) * 1.6, start)
      v.synth.triggerAttackRelease(midiToNote(m), 1.8, start, 0.55)
      v.lastStart = start
    })
    this.drone.triggerAttack(['D2', 'A2', 'F3'], t + 0.2, 0.5)
    this.droneFilter.frequency.rampTo(700, 3)
    this.burnedBus.volume.rampTo(-8, 2)
    this.droneTremolo.depth.rampTo(0, 1)
  }

  /** Últimas mediciones (para describir el momento). */
  get lastFeatures(): FireFeatures | null {
    return this.last
  }
}
