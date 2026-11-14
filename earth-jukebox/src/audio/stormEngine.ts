import * as Tone from 'tone'
import type { FrameFeatures, Strike } from '../analysis/detector'
import {
  SEASON_CHORDS, SLOT, chordIndexFor, chordLadder, isMelodic, midiToNote, textureTicks,
} from './harmony'
import { MelodyPlanner, SlotQueue, type NoteEvent, type Region } from './melody'
import { NoteBudget, densityGain, pickVoice, rankOf, safeStart, type NoteRole } from './budget'
import { balanceOf, lonToPan } from './mapping'

/**
 * Motor de sonido "Tormentas del planeta".
 *
 * Todo suena sobre un pulso (semicorcheas a 105 BPM) y en armonía con el acorde de la estación.
 *
 *  RAYOS (melodía)   solo los grupos grandes (≥1000; ~8 % de los eventos), uno por tiempo; la
 *                    intensidad decide si suenan negras, corcheas o semicorcheas (slotAllows).
 *                    Las notas se relacionan entre sí (melody.ts): voz por región, movimiento por
 *                    pasos, conversación entre regiones, arpegios que suben o bajan, resolución.
 *                    - latitud     → hacia dónde camina la melodía (norte = sube)
 *                    - longitud    → audífono izquierdo/derecho (mapping.ts)
 *                    - tamaño      → volumen y duración
 *                    - tormenta    → 1 nota (aislado), 2 notas (1–2 vecinas) o arpegio (3+ vecinas)
 *                    - tierra      → piano eléctrico suave · océano → vibráfono (más raro)
 *                    - tormenta nueva → campanita aguda de acento
 *  RAYOS (textura)   grupos chicos y medianos (~92 %) → destellos agudos en notas del acorde; su número
 *                    sube con la cantidad de rayos.
 *  TRUENOS           grupos muy grandes (≥2500) → retumbo grave EN LA NOTA BASE del acorde.
 *  ESTACIONES        acorde de fondo según la latitud promedio de todas las tormentas.
 *
 * Protección contra saturación y fallos (budget.ts):
 *  - presupuesto de notas por segundo con prioridades (los destellos se sacrifican primero);
 *  - voces asignadas por disponibilidad (20 de piano, 8 de vibráfono) y horas de inicio seguras;
 *  - compresor suave antes del limitador;
 *  - cualquier error dentro de update() se cuenta y el motor sigue (no mata el bucle).
 */

export interface LayerState {
  strikes: boolean
  thunder: boolean
  seasons: boolean
}

export interface PlayedStrike extends Strike {
  note: string
  voices: number
  region: Region
  /** 1 arpegio sube, -1 baja, 0 una nota */
  direction: 1 | -1 | 0
}

type Voice = { synth: Tone.FMSynth; panner: Tone.Panner; busyUntil: number; lastStart: number }

export interface EngineStats {
  notesPerSec: number
  dropped: number
  admitted: number
  errors: number
  lastError: string
  resumes: number
  context: string
}

const LOOKAHEAD = 0.12
/** Máximo de tiempos del pulso que se tocan en una sola llamada (si hubo retraso, se saltan). */
const MAX_SLOTS_PER_UPDATE = 8
const MALLET_VOICES = 20
const BELL_VOICES = 8
/** Cola audible aproximada tras soltar la nota (release de cada instrumento). */
const RELEASE = { marimba: 1.0, campana: 1.8 }
const THUNDER_COOLDOWN = 4
const THUNDER_ENERGY = 2500
/** Brillo base del piano eléctrico (índice de modulación FM). */
const RHODES_BRIGHTNESS = 2.4

export class StormEngine {
  private started = false
  private master!: Tone.Volume
  private meter!: Tone.Meter
  private strikeBus!: Tone.Volume
  private thunderBus!: Tone.Volume
  private seasonBus!: Tone.Volume
  private mallets: Voice[] = []
  private bells: Voice[] = []
  private sparkle!: Tone.PolySynth
  private tickPanner!: Tone.Panner
  private thunderSynth!: Tone.MembraneSynth
  private thunderNoise!: Tone.NoiseSynth
  private thunderPanner!: Tone.Panner
  private pad!: Tone.PolySynth
  private padFilter!: Tone.Filter
  private currentChord = -1
  private lastThunder = -Infinity
  private layers: LayerState = { strikes: true, thunder: true, seasons: true }

  // Planificador del pulso
  private nextSlot = -1
  private queue = new SlotQueue()
  private smallCount = 0
  private smallBalance: Strike[] = []
  private planner = new MelodyPlanner()
  /** Veces que la melodía resolvió en la calma (para la interfaz). */
  resolutions = 0
  private budget = new NoteBudget()
  private thunderLastStart = 0
  private errors = 0
  private lastError = ''
  private resumes = 0

  /** Estadísticas para la sección de diagnóstico (?debug). */
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

  /** Registra un error sin detener nada. */
  noteError(e: unknown) {
    this.errors++
    this.lastError = e instanceof Error ? e.message : String(e)
    if (import.meta.env.DEV) console.warn('[StormEngine]', this.lastError)
  }

  /** Si el navegador suspendió el audio (p. ej. cambio de dispositivo), intenta reanudarlo. */
  private ensureRunning() {
    const ctx = Tone.getContext()
    if (ctx.state !== 'running') {
      this.resumes++
      void ctx.resume().catch(() => {})
    }
  }

  /** Nivel de salida 0..1 (para el indicador de audio). */
  getLevel(): number {
    if (!this.started) return 0
    const v = this.meter.getValue()
    return typeof v === 'number' ? v : Math.max(...v)
  }

  get contextState(): string {
    return Tone.getContext().state
  }

  get isStarted() {
    return this.started
  }

  /** Debe llamarse desde un clic/tecla del usuario (requisito de los navegadores). */
  async start(): Promise<void> {
    if (this.started) return
    await Tone.start()

    const limiter = new Tone.Limiter(-1).toDestination()
    // Compresor suave: controla la suma de capas antes del limitador, que así casi no "bombea".
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.25, knee: 8 }).connect(limiter)
    this.master = new Tone.Volume(0).connect(compressor)
    this.meter = new Tone.Meter({ normalRange: true, smoothing: 0.6, channelCount: 2 })
    limiter.connect(this.meter)
    // Sala más amplia y cálida (pre-delay corto para que el ataque se oiga claro).
    const reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.03, wet: 0.3 }).connect(this.master)

    // --- Rayos: melodía ---
    // Cadena: voces → coro (ensancha y da calidez) → eco a corchea con puntillo (sincronizado
    // con el pulso, muy suave) → sala.
    const echo = new Tone.FeedbackDelay({ delayTime: SLOT * 3, feedback: 0.22, wet: 0.16 }).connect(reverb)
    const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.45, spread: 50, wet: 0.4 }).connect(echo).start()
    this.strikeBus = new Tone.Volume(4).connect(chorus)
    // Tierra: piano eléctrico suave tipo Rhodes (FM 1:1; el brillo baja tras el ataque).
    for (let i = 0; i < MALLET_VOICES; i++) {
      const panner = new Tone.Panner(0).connect(this.strikeBus)
      const synth = new Tone.FMSynth({
        harmonicity: 1,
        modulationIndex: RHODES_BRIGHTNESS,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.004, decay: 1.3, sustain: 0.12, release: 1.0 },
        modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.08, release: 0.5 },
      }).connect(panner)
      this.mallets.push({ synth, panner, busyUntil: 0, lastStart: 0 })
    }
    // Océano y acentos: vibráfono (campana suave con trémolo lento, como el motor del vibráfono).
    const vibes = new Tone.Tremolo({ frequency: 4.5, depth: 0.3, spread: 0 }).connect(this.strikeBus).start()
    for (let i = 0; i < BELL_VOICES; i++) {
      const panner = new Tone.Panner(0).connect(vibes)
      const synth = new Tone.FMSynth({
        harmonicity: 4,
        modulationIndex: 0.9,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.008, decay: 2.4, sustain: 0, release: 1.8 },
        modulationEnvelope: { attack: 0.004, decay: 0.25, sustain: 0, release: 0.3 },
        volume: -3,
      }).connect(panner)
      this.bells.push({ synth, panner, busyUntil: 0, lastStart: 0 })
    }
    // --- Rayos: textura → destellos agudos y suaves EN NOTAS DEL ACORDE (como lluvia brillante) ---
    this.tickPanner = new Tone.Panner(0).connect(this.strikeBus)
    this.sparkle = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.25 },
      volume: -17,
    }).connect(this.tickPanner)

    // --- Truenos ---
    this.thunderBus = new Tone.Volume(4).connect(reverb)
    this.thunderPanner = new Tone.Panner(0).connect(this.thunderBus)
    const thunderFilter = new Tone.Filter({ type: 'lowpass', frequency: 320 }).connect(this.thunderPanner)
    this.thunderSynth = new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 1.5,
      envelope: { attack: 0.01, decay: 1.6, sustain: 0, release: 1.2 },
    }).connect(thunderFilter)
    this.thunderNoise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.08, decay: 1.8, sustain: 0, release: 1 },
      volume: -8,
    }).connect(thunderFilter)

    // --- Estaciones ---
    this.seasonBus = new Tone.Volume(-2).connect(reverb)
    this.padFilter = new Tone.Filter({ type: 'lowpass', frequency: 400, Q: 0.6 }).connect(this.seasonBus)
    // Colchón cálido: tres osciladores triangulares ligeramente desafinados entre sí.
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fattriangle', count: 3, spread: 18 },
      envelope: { attack: 2.5, decay: 0.5, sustain: 0.9, release: 4 },
      volume: -4,
    }).connect(this.padFilter)

    this.started = true
    this.applyLayers()
  }

  /** Sonido de prueba: piano eléctrico a la izquierda, a la derecha, al centro, y un trueno. */
  testSound() {
    if (!this.started) return
    const now = Tone.now() + 0.05
    const notes: [number, number][] = [[69, -1], [74, 1], [77, 0]] // La4 izq · Re5 der · Fa5 centro
    notes.forEach(([midi, pan], i) => {
      this.playNote({ midi, offset: 0, velocity: 0.9, duration: 0.4, pan, timbre: 'marimba', role: 'melodia', lead: true }, now + i * 0.3, 1)
    })
    this.playThunder('D1', 0, now + 1)
  }

  setLayers(layers: LayerState) {
    this.layers = layers
    if (this.started) this.applyLayers()
  }

  setVolume(db: number) {
    if (this.started) this.master.volume.rampTo(db, 0.1)
  }

  private applyLayers() {
    this.strikeBus.mute = !this.layers.strikes
    this.thunderBus.mute = !this.layers.thunder
    this.seasonBus.mute = !this.layers.seasons
  }

  /** Silencia todo (pausa) sin destruir el motor. */
  silence() {
    if (!this.started) return
    this.pad.releaseAll()
    this.currentChord = -1
    this.resetScheduler()
  }

  private resetScheduler() {
    this.nextSlot = -1
    this.queue.reset()
    this.smallCount = 0
    this.smallBalance = []
    this.planner.reset()
    this.budget.reset()
  }

  /**
   * Recibe las mediciones de un cuadro. Los rayos no suenan al instante: se juntan y
   * se tocan en el siguiente tiempo del pulso, ya armonizados.
   * @returns lo que se programó para sonar (para dibujarlo), el acorde y el balance.
   */
  update(f: FrameFeatures, dt: number): { played: PlayedStrike[]; thunder: Strike | null; chord: string; balance: number | null } {
    if (!this.started) return { played: [], thunder: null, chord: '', balance: null }
    try {
      this.ensureRunning()
      return this.updateUnsafe(f, dt)
    } catch (e) {
      // Un error nunca debe detener el sonido: se cuenta, se reinicia el planificador y se sigue.
      this.noteError(e)
      this.resetScheduler()
      return { played: [], thunder: null, chord: '', balance: null }
    }
  }

  private updateUnsafe(f: FrameFeatures, _dt: number): { played: PlayedStrike[]; thunder: Strike | null; chord: string; balance: number | null } {
    const now = Tone.now()
    if (f.isReset) this.resetScheduler()

    // 1) Estaciones primero: la melodía usa el acorde actual.
    let chordName = ''
    if (f.activity > 0.01) {
      const idx = chordIndexFor(f.meanLat, this.currentChord)
      chordName = SEASON_CHORDS[idx].name
      if (idx !== this.currentChord) {
        if (this.currentChord >= 0) this.pad.releaseAll(now)
        this.pad.triggerAttack(SEASON_CHORDS[idx].notes, now + 0.05, 0.7)
        this.currentChord = idx
      }
      this.padFilter.frequency.rampTo(500 + f.activity * 2200, 0.5)
    } else if (this.currentChord >= 0) {
      this.pad.releaseAll(now)
      this.currentChord = -1
    }

    // 2) Clasificar los rayos de este cuadro: melodía (grandes) o textura (chicos/medianos).
    for (const s of f.strikes) {
      this.queue.add(s)
      if (!isMelodic(s)) {
        this.smallCount++
        if (this.smallBalance.length < 64) this.smallBalance.push(s)
      }
    }

    // 3) Tocar los tiempos del pulso que caen dentro de la ventana de anticipación.
    if (this.nextSlot < 0 || this.nextSlot < now - SLOT) this.nextSlot = Math.ceil(now / SLOT) * SLOT
    const played: PlayedStrike[] = []
    let thunder: Strike | null = null
    let flushed = 0
    while (this.nextSlot < now + LOOKAHEAD && flushed++ < MAX_SLOTS_PER_UPDATE) {
      const r = this.flushSlot(this.nextSlot)
      played.push(...r.played)
      if (r.thunder) thunder = r.thunder
      this.nextSlot += SLOT
    }
    if (this.nextSlot < now) this.nextSlot = Math.ceil(now / SLOT) * SLOT // retraso acumulado: saltar

    return { played, thunder, chord: chordName, balance: balanceOf(f.strikes) }
  }

  private flushSlot(t: number): { played: PlayedStrike[]; thunder: Strike | null } {
    const played: PlayedStrike[] = []
    let thunder: Strike | null = null
    const chordIdx = this.currentChord >= 0 ? this.currentChord : 0

    // 1) El planificador decide las notas (pasos, voces por región, conversación, arpegios, resolución).
    const sub = Math.round(t / SLOT) % 4
    const { candidates, arrivals } = this.queue.take(sub)
    const plan = this.planner.planSlot(sub, candidates, chordIdx, arrivals)
    if (plan.resolution) this.resolutions++

    // 2) Todo lo que quiere sonar en este tiempo, con su importancia.
    type Item = { rank: number; time: number; play: (gain: number) => void }
    const items: Item[] = plan.events.map((e) => {
      const role: NoteRole = e.role === 'resolucion' ? 'resolucion' : e.role === 'acento' ? 'acento' : e.lead ? 'lider' : 'acompanante'
      return { rank: rankOf(role), time: t + e.offset, play: (g: number) => this.playNote(e, t + e.offset, g) }
    })
    const ticks = textureTicks(this.smallCount)
    if (ticks > 0) {
      const b = balanceOf(this.smallBalance)
      const high = chordLadder(chordIdx, 84, 98) // notas del acorde en Do6–Re7
      for (let k = 0; k < ticks; k++) {
        const tk = t + (k * SLOT) / ticks + 0.003
        const m = high[Math.floor(Math.random() * high.length)]
        items.push({ rank: rankOf('destello'), time: tk, play: (g) => this.playSparkle(m, tk, g, b ?? 0) })
      }
    }

    // 3) Presupuesto: primero lo más importante; solo se omiten notas, nunca se cambian.
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

    // 4) Lo que se muestra en pantalla y el trueno.
    if (plan.group) {
      const g = plan.group
      const s = g.strike
      played.push({ ...s, note: midiToNote(g.midi), voices: g.notes, region: g.region, direction: g.direction })
      if (s.energy >= THUNDER_ENERGY && t - this.lastThunder > THUNDER_COOLDOWN) {
        this.lastThunder = t
        thunder = s
        try {
          this.playThunder(SEASON_CHORDS[chordIdx].tones[0] + '1', lonToPan(s.lon), t + 0.35)
        } catch (e) {
          this.noteError(e)
        }
      }
    }

    this.queue.endSlot(sub, plan.group !== null)
    this.smallCount = 0
    this.smallBalance = []
    return { played, thunder }
  }

  /** Toca una nota en la voz más libre del instrumento, con hora de inicio segura. */
  private playNote(e: NoteEvent, time: number, gain: number) {
    const pool = e.timbre === 'marimba' ? this.mallets : this.bells
    const i = pickVoice(pool.map((v) => v.busyUntil), time)
    const v = pool[i]
    const start = safeStart(time, v.lastStart, Tone.getContext().currentTime)
    v.panner.pan.setValueAtTime(e.pan, start)
    // Como en un instrumento real: tocar más fuerte también suena más brillante.
    if (e.timbre === 'marimba') v.synth.modulationIndex.setValueAtTime(RHODES_BRIGHTNESS * (0.6 + e.velocity * 0.7), start)
    v.synth.triggerAttackRelease(midiToNote(e.midi), e.duration, start, e.velocity * gain)
    v.lastStart = start
    v.busyUntil = start + e.duration + RELEASE[e.timbre]
  }

  private playSparkle(midi: number, time: number, gain: number, pan: number) {
    const start = Math.max(time, Tone.getContext().currentTime + 0.002)
    this.tickPanner.pan.setValueAtTime(pan, start)
    this.sparkle.triggerAttackRelease(midiToNote(midi), 0.05, start, (0.3 + Math.random() * 0.3) * gain)
  }

  private playThunder(note: string, pan: number, time: number) {
    const start = safeStart(time, this.thunderLastStart, Tone.getContext().currentTime)
    this.thunderPanner.pan.setValueAtTime(pan, start)
    this.thunderSynth.triggerAttackRelease(note, 1.4, start, 0.85)
    this.thunderNoise.triggerAttackRelease(1.4, start, 0.5)
    this.thunderLastStart = start
  }

  dispose() {
    if (!this.started) return
    this.pad.releaseAll()
  }
}
