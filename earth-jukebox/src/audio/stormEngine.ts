import * as Tone from 'tone'
import type { FrameFeatures, Strike } from '../analysis/detector'
import {
  SEASON_CHORDS, SLOT, chordIndexFor, chordLadder, isMelodic, midiToNote, priority, textureTicks,
} from './harmony'
import { MelodyPlanner, type Region } from './melody'
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

type Voice = { synth: Tone.FMSynth; panner: Tone.Panner }

const LOOKAHEAD = 0.12
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
  private nextMallet = 0
  private nextBell = 0
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
  private pending: Strike[] = []
  private smallCount = 0
  private smallBalance: Strike[] = []
  private planner = new MelodyPlanner()
  /** Veces que la melodía resolvió en la calma (para la interfaz). */
  resolutions = 0

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

    const limiter = new Tone.Limiter(-2).toDestination()
    this.master = new Tone.Volume(0).connect(limiter)
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
    for (let i = 0; i < 10; i++) {
      const panner = new Tone.Panner(0).connect(this.strikeBus)
      const synth = new Tone.FMSynth({
        harmonicity: 1,
        modulationIndex: RHODES_BRIGHTNESS,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.004, decay: 1.3, sustain: 0.12, release: 1.0 },
        modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.08, release: 0.5 },
      }).connect(panner)
      this.mallets.push({ synth, panner })
    }
    // Océano y acentos: vibráfono (campana suave con trémolo lento, como el motor del vibráfono).
    const vibes = new Tone.Tremolo({ frequency: 4.5, depth: 0.3, spread: 0 }).connect(this.strikeBus).start()
    for (let i = 0; i < 4; i++) {
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
      this.bells.push({ synth, panner })
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
    const notes: [string, number][] = [['A4', -1], ['D5', 1], ['F5', 0]]
    notes.forEach(([n, pan], i) => {
      const v = this.mallets[i]
      v.panner.pan.setValueAtTime(pan, now + i * 0.3)
      v.synth.triggerAttackRelease(n, 0.4, now + i * 0.3, 0.9)
    })
    this.thunderPanner.pan.setValueAtTime(0, now + 1)
    this.thunderSynth.triggerAttackRelease('D1', 1.4, now + 1, 0.9)
    this.thunderNoise.triggerAttackRelease(1.5, now + 1, 0.6)
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
    this.pending = []
    this.smallCount = 0
    this.smallBalance = []
    this.planner.reset()
  }

  /**
   * Recibe las mediciones de un cuadro. Los rayos no suenan al instante: se juntan y
   * se tocan en el siguiente tiempo del pulso, ya armonizados.
   * @returns lo que se programó para sonar (para dibujarlo), el acorde y el balance.
   */
  update(f: FrameFeatures, _dt: number): { played: PlayedStrike[]; thunder: Strike | null; chord: string; balance: number | null } {
    if (!this.started) return { played: [], thunder: null, chord: '', balance: null }
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
      if (isMelodic(s)) this.pending.push(s)
      else {
        this.smallCount++
        if (this.smallBalance.length < 64) this.smallBalance.push(s)
      }
    }
    if (this.pending.length > 48) {
      this.pending.sort((a, b) => priority(b) - priority(a))
      this.pending.length = 48
    }

    // 3) Tocar los tiempos del pulso que caen dentro de la ventana de anticipación.
    if (this.nextSlot < 0 || this.nextSlot < now - SLOT) this.nextSlot = Math.ceil(now / SLOT) * SLOT
    const played: PlayedStrike[] = []
    let thunder: Strike | null = null
    while (this.nextSlot < now + LOOKAHEAD) {
      const r = this.flushSlot(this.nextSlot)
      played.push(...r.played)
      if (r.thunder) thunder = r.thunder
      this.nextSlot += SLOT
    }

    return { played, thunder, chord: chordName, balance: balanceOf(f.strikes) }
  }

  private flushSlot(t: number): { played: PlayedStrike[]; thunder: Strike | null } {
    const played: PlayedStrike[] = []
    let thunder: Strike | null = null
    const chordIdx = this.currentChord >= 0 ? this.currentChord : 0

    // Melodía: el planificador relaciona las notas entre sí (pasos, voces por región,
    // conversación, arpegios con dirección, resolución en la calma). Ver melody.ts.
    const sub = Math.round(t / SLOT) % 4
    const plan = this.planner.planSlot(sub, this.pending, chordIdx)
    for (const e of plan.events) {
      const v = e.timbre === 'marimba'
        ? this.mallets[this.nextMallet++ % this.mallets.length]
        : this.bells[this.nextBell++ % this.bells.length]
      const time = t + e.offset
      v.panner.pan.setValueAtTime(e.pan, time)
      // Como en un instrumento real: tocar más fuerte también suena más brillante.
      if (e.timbre === 'marimba') v.synth.modulationIndex.setValueAtTime(RHODES_BRIGHTNESS * (0.6 + e.velocity * 0.7), time)
      v.synth.triggerAttackRelease(midiToNote(e.midi), e.duration, time, e.velocity)
    }
    if (plan.group) {
      const g = plan.group
      const s = g.strike
      played.push({ ...s, note: midiToNote(g.midi), voices: g.notes, region: g.region, direction: g.direction })
      // Trueno: grupo muy grande → retumbo en la nota base del acorde.
      if (s.energy >= THUNDER_ENERGY && t - this.lastThunder > THUNDER_COOLDOWN) {
        this.lastThunder = t
        thunder = s
        const base = SEASON_CHORDS[chordIdx].tones[0] + '1'
        const tt = t + 0.35
        this.thunderPanner.pan.setValueAtTime(lonToPan(s.lon), tt)
        this.thunderSynth.triggerAttackRelease(base, 1.4, tt, 0.85)
        this.thunderNoise.triggerAttackRelease(1.4, tt, 0.5)
      }
    }
    if (plan.resolution) this.resolutions++

    // Textura: chispazos en subdivisiones del pulso, del lado donde caen los rayos chicos.
    const ticks = textureTicks(this.smallCount)
    if (ticks > 0) {
      const b = balanceOf(this.smallBalance)
      this.tickPanner.pan.setValueAtTime(b ?? 0, t)
      const high = chordLadder(chordIdx, 84, 98) // notas del acorde en Do6–Re7
      for (let k = 0; k < ticks; k++) {
        const tk = t + (k * SLOT) / ticks + 0.003
        const m = high[Math.floor(Math.random() * high.length)]
        this.sparkle.triggerAttackRelease(midiToNote(m), 0.05, tk, 0.3 + Math.random() * 0.3)
      }
    }

    this.pending = []
    this.smallCount = 0
    this.smallBalance = []
    return { played, thunder }
  }

  dispose() {
    if (!this.started) return
    this.pad.releaseAll()
  }
}
