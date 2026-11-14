import * as Tone from 'tone'
import type { FrameFeatures, Strike } from '../analysis/detector'
import { balanceOf, lonToPan } from './mapping'

/**
 * Motor de sonido "Tormentas del planeta".
 *
 * Reglas de traducción imagen → sonido (las mismas que se explican en la interfaz):
 *  RAYOS      cada rayo nuevo = una nota corta tipo campana eléctrica.
 *             - latitud  → altura (norte = agudo, sur = grave)
 *             - longitud → paneo: el mapa se parte con una línea vertical al centro;
 *               izquierda del mapa = audífono izquierdo, derecha = derecho (ver mapping.ts)
 *             - energía  → volumen
 *             La cantidad de rayos nuevos controla cuántas notas por segundo
 *             y un "chisporroteo" de fondo.
 *  TRUENOS    cuando aparece un grupo grande de rayos juntos, suena un retumbo
 *             grave con retraso (primero se ve el rayo, luego llega el trueno).
 *  ESTACIONES un acorde de fondo cuya nota base sigue la latitud promedio de las
 *             tormentas: al moverse hacia el norte o el sur con las estaciones,
 *             el acorde sube o baja. La actividad total abre el filtro (más brillo).
 */

/** Escala pentatónica de Re menor: casi imposible que suene "mal". */
const STRIKE_SCALE = [
  'D3', 'F3', 'G3', 'A3', 'C4',
  'D4', 'F4', 'G4', 'A4', 'C5',
  'D5', 'F5', 'G5', 'A5', 'C6',
]
/** Rango de latitudes donde el sensor LIS ve rayos. */
const LAT_MIN = -50
const LAT_MAX = 50

/**
 * Acordes del fondo, de sur a norte. La latitud promedio medida en el video
 * oscila aprox. entre -15° (verano austral) y +33° (verano boreal).
 */
const SEASON_CHORDS: { maxLat: number; notes: string[]; name: string }[] = [
  { maxLat: -8, notes: ['D2', 'A2', 'F3', 'C4'], name: 'Re menor' },
  { maxLat: 4, notes: ['F2', 'C3', 'A3', 'E4'], name: 'Fa mayor' },
  { maxLat: 16, notes: ['G2', 'D3', 'A3', 'F4'], name: 'Sol suspendido' },
  { maxLat: 26, notes: ['A2', 'E3', 'C4', 'G4'], name: 'La menor' },
  { maxLat: 999, notes: ['C3', 'G3', 'E4', 'D5'], name: 'Do mayor' },
]

export interface LayerState {
  strikes: boolean
  thunder: boolean
  seasons: boolean
}

export interface PlayedStrike extends Strike {
  note: string
}

const VOICE_COUNT = 10
const MAX_NOTES_PER_SECOND = 14
const MIN_NOTES_PER_SECOND = 1.5
const THUNDER_ENERGY = 3000
const THUNDER_COOLDOWN = 1.5

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}

export class StormEngine {
  private started = false
  private master!: Tone.Volume
  private meter!: Tone.Meter
  private strikeBus!: Tone.Volume
  private thunderBus!: Tone.Volume
  private seasonBus!: Tone.Volume
  private voices: { synth: Tone.FMSynth; panner: Tone.Panner }[] = []
  private nextVoice = 0
  private crackle!: Tone.Noise
  private crackleGain!: Tone.Gain
  private cracklePanner!: Tone.Panner
  private thunderSynth!: Tone.MembraneSynth
  private thunderNoise!: Tone.NoiseSynth
  private thunderPanner!: Tone.Panner
  private pad!: Tone.PolySynth
  private padFilter!: Tone.Filter
  private currentChord = -1
  private noteBudget = 0
  private lastThunder = -Infinity
  private layers: LayerState = { strikes: true, thunder: true, seasons: true }

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
    const reverb = new Tone.Reverb({ decay: 4, wet: 0.2 }).connect(this.master)

    // --- Rayos ---
    this.strikeBus = new Tone.Volume(4).connect(reverb)
    for (let i = 0; i < VOICE_COUNT; i++) {
      const panner = new Tone.Panner(0).connect(this.strikeBus)
      const synth = new Tone.FMSynth({
        harmonicity: 3.01,
        modulationIndex: 9,
        oscillator: { type: 'sine' },
        modulation: { type: 'square' },
        envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
        modulationEnvelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.1 },
      }).connect(panner)
      this.voices.push({ synth, panner })
    }
    // Chisporroteo: ruido filtrado cuyo volumen sigue la cantidad de rayos nuevos.
    const crackleFilter = new Tone.Filter({ type: 'bandpass', frequency: 3200, Q: 0.8 })
    // El chisporroteo también se mueve al lado donde están cayendo los rayos nuevos.
    this.cracklePanner = new Tone.Panner(0).connect(this.strikeBus)
    this.crackleGain = new Tone.Gain(0).connect(this.cracklePanner)
    const crackleTremolo = new Tone.Tremolo({ frequency: 13, depth: 0.9, spread: 0 }).start()
    this.crackle = new Tone.Noise('white')
    this.crackle.chain(crackleFilter, crackleTremolo, this.crackleGain)
    this.crackle.start()

    // --- Truenos ---
    this.thunderBus = new Tone.Volume(6).connect(reverb)
    this.thunderPanner = new Tone.Panner(0).connect(this.thunderBus)
    const thunderFilter = new Tone.Filter({ type: 'lowpass', frequency: 260 }).connect(this.thunderPanner)
    this.thunderSynth = new Tone.MembraneSynth({
      pitchDecay: 0.25,
      octaves: 3,
      envelope: { attack: 0.01, decay: 1.4, sustain: 0, release: 1 },
    }).connect(thunderFilter)
    this.thunderNoise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.05, decay: 2.2, sustain: 0, release: 1 },
    }).connect(thunderFilter)

    // --- Estaciones ---
    this.seasonBus = new Tone.Volume(-2).connect(reverb)
    this.padFilter = new Tone.Filter({ type: 'lowpass', frequency: 400, Q: 0.6 }).connect(this.seasonBus)
    this.pad = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 1.5,
      oscillator: { type: 'triangle' },
      envelope: { attack: 2.5, decay: 0.5, sustain: 0.9, release: 4 },
    }).connect(this.padFilter)

    this.started = true
    this.applyLayers()
  }

  /** Sonido de prueba: un rayo a la izquierda, uno a la derecha y un trueno. */
  testSound() {
    if (!this.started) return
    const now = Tone.now()
    const notes: [string, number][] = [['A4', -1], ['D5', 1], ['F5', 0]]
    notes.forEach(([n, pan], i) => {
      const v = this.voices[i]
      v.panner.pan.setValueAtTime(pan, now + i * 0.25)
      v.synth.triggerAttackRelease(n, 0.3, now + i * 0.25, 0.9)
    })
    this.thunderSynth.triggerAttackRelease('A0', 1.2, now + 0.9, 0.9)
    this.thunderNoise.triggerAttackRelease(1.5, now + 0.9, 0.7)
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
    this.crackleGain.gain.rampTo(0, 0.2)
    this.pad.releaseAll()
    this.currentChord = -1
    this.noteBudget = 0
  }

  /**
   * Convierte las mediciones de un cuadro en sonido.
   * @param dt segundos reales desde el cuadro anterior
   * @returns los rayos que sonaron (para dibujarlos en pantalla)
   */
  update(f: FrameFeatures, dt: number): { played: PlayedStrike[]; thunder: Strike | null; chord: string; balance: number | null } {
    if (!this.started) return { played: [], thunder: null, chord: '', balance: null }
    const now = Tone.now()
    const played: PlayedStrike[] = []
    let thunder: Strike | null = null

    // 1) Chisporroteo según la cantidad de rayos nuevos.
    this.crackleGain.gain.rampTo(0.04 + f.newRate * 0.3, 0.15)
    const balance = balanceOf(f.strikes)
    if (balance !== null) this.cracklePanner.pan.rampTo(balance, 0.2)

    // 2) Notas: el número por segundo crece con la intensidad de rayos nuevos.
    if (f.strikes.length > 0 && !f.isReset) {
      const rate = MIN_NOTES_PER_SECOND + (MAX_NOTES_PER_SECOND - MIN_NOTES_PER_SECOND) * f.newRate
      this.noteBudget = Math.min(this.noteBudget + rate * dt, 4)
      const chosen = pickSpread(f.strikes, Math.floor(this.noteBudget))
      this.noteBudget -= chosen.length
      chosen.forEach((s, i) => {
        const note = latToNote(s.lat)
        const v = this.voices[this.nextVoice]
        this.nextVoice = (this.nextVoice + 1) % VOICE_COUNT
        const t = now + 0.01 + (i * Math.max(dt, 0.03)) / Math.max(chosen.length, 1)
        v.panner.pan.setValueAtTime(lonToPan(s.lon), t)
        const velocity = clamp(0.5 + s.energy / 2500, 0.5, 1)
        v.synth.triggerAttackRelease(note, 0.3, t, velocity)
        played.push({ ...s, note })
      })
    } else {
      this.noteBudget = 0
    }

    // 3) Trueno: grupo grande de rayos nuevos → retumbo con retraso.
    const strongest = f.strikes[0]
    if (strongest && f.peakEnergy > THUNDER_ENERGY && now - this.lastThunder > THUNDER_COOLDOWN) {
      this.lastThunder = now
      thunder = strongest
      const delay = 0.25 + Math.random() * 0.35
      this.thunderPanner.pan.setValueAtTime(lonToPan(strongest.lon), now + delay)
      const vel = clamp(f.peakEnergy / 5000, 0.4, 1)
      this.thunderSynth.triggerAttackRelease('A0', 1.2, now + delay, vel)
      this.thunderNoise.triggerAttackRelease(1.5, now + delay, vel * 0.8)
    }

    // 4) Estaciones: acorde según la latitud promedio; brillo según la actividad.
    let chordName = ''
    if (f.activity > 0.01) {
      const idx = chordIndexFor(f.meanLat, this.currentChord)
      chordName = SEASON_CHORDS[idx].name
      if (idx !== this.currentChord) {
        if (this.currentChord >= 0) this.pad.releaseAll(now)
        this.pad.triggerAttack(SEASON_CHORDS[idx].notes, now + 0.05, 0.8)
        this.currentChord = idx
      }
      this.padFilter.frequency.rampTo(500 + f.activity * 2200, 0.5)
    } else if (this.currentChord >= 0) {
      this.pad.releaseAll(now)
      this.currentChord = -1
    }

    return { played, thunder, chord: chordName, balance }
  }

  dispose() {
    if (!this.started) return
    this.crackle.stop()
    this.pad.releaseAll()
  }
}

/** Latitud → nota de la escala (norte = agudo). */
export function latToNote(lat: number): string {
  const t = clamp((lat - LAT_MIN) / (LAT_MAX - LAT_MIN), 0, 0.9999)
  return STRIKE_SCALE[Math.floor(t * STRIKE_SCALE.length)]
}

/** Elige el acorde con histéresis de 2° para que no "tiemble" en las fronteras. */
export function chordIndexFor(meanLat: number, current: number): number {
  let idx = SEASON_CHORDS.findIndex((c) => meanLat <= c.maxLat)
  if (idx < 0) idx = SEASON_CHORDS.length - 1
  if (current >= 0 && idx !== current) {
    const lo = current > 0 ? SEASON_CHORDS[current - 1].maxLat : -999
    const hi = SEASON_CHORDS[current].maxLat
    if (meanLat > lo - 2 && meanLat <= hi + 2) return current
  }
  return idx
}

/** Toma los rayos más fuertes pero evitando que todos sean del mismo lugar. */
export function pickSpread(strikes: Strike[], n: number): Strike[] {
  const out: Strike[] = []
  for (const s of strikes) {
    if (out.length >= n) break
    if (out.every((o) => Math.abs(o.x - s.x) > 0.06 || Math.abs(o.y - s.y) > 0.1)) out.push(s)
  }
  return out
}
