import type { Strike } from '../analysis/detector'
import { SEASON_CHORDS, STRUM, chordLadder, dynamics, isMelodic, latToLadderIndex, priority, slotAllows } from './harmony'
import { lonToPan } from './mapping'

/**
 * Planificador de melodía de la capa de rayos (lógica pura: se puede probar y simular).
 *
 * Las notas ya no se eligen sueltas: se relacionan entre sí según la estructura de los rayos.
 *  1. PASOS        La melodía camina hacia la nota de la latitud, máx. 2 notas del acorde por paso.
 *                  Norte sigue siendo "hacia arriba" y sur "hacia abajo", pero sin saltos bruscos.
 *  2. VOCES        Una voz por región, cada una en su registro (coincide con los audífonos):
 *                  América (izquierda) grave · Europa y África (centro) media · Asia y Oceanía (derecha) aguda.
 *  3. CONVERSACIÓN Por frases: una región toca hasta `phraseLength` notas seguidas y luego contesta otra
 *                  región que también tenga rayos grandes (con al menos la mitad de prioridad).
 *  5. ARPEGIOS     Tormenta creciendo (más zonas vecinas que la vez anterior en esa región) → sube;
 *                  encogiéndose → baja.
 *  6. RESOLUCIÓN   Cuando la actividad cae claramente por debajo de su promedio, suena la nota base del
 *                  acorde y las voces regresan a ella: un respiro.
 */

export type Region = 'oeste' | 'centro' | 'este'

export const REGION_NAME: Record<Region, string> = {
  oeste: 'América',
  centro: 'Europa y África',
  este: 'Asia y Oceanía',
}

/** Registro (notas MIDI) de cada voz. Se traslapan un poco para que las voces se toquen. */
export const REGION_RANGE: Record<Region, [number, number]> = {
  oeste: [48, 67], // Do3–Sol4
  centro: [55, 76], // Sol3–Mi5
  este: [64, 86], // Mi4–Re6
}

/** Máximo de pasos (notas del acorde) que la melodía se mueve de una nota a la siguiente. */
export const MAX_STEP = 2

export function regionOf(lon: number): Region {
  if (lon < -30) return 'oeste'
  if (lon < 60) return 'centro'
  return 'este'
}

export function regionLadder(chordIdx: number, region: Region): number[] {
  const [lo, hi] = REGION_RANGE[region]
  return chordLadder(chordIdx, lo, hi)
}

export interface NoteEvent {
  midi: number
  /** Segundos después del inicio del tiempo del pulso. */
  offset: number
  velocity: number
  duration: number
  pan: number
  timbre: 'marimba' | 'campana'
  role: 'melodia' | 'acento' | 'resolucion'
  /** true en la nota que lleva la melodía (las demás del arpegio la acompañan). */
  lead?: boolean
}

export interface PlannedGroup {
  strike: Strike
  region: Region
  /** Dirección del arpegio: 1 sube, -1 baja, 0 una sola nota. */
  direction: 1 | -1 | 0
  notes: number
  midi: number
}

interface VoiceState {
  idx: number
  lastNeighbors: number
  initialized: boolean
}

export interface MelodyOptions {
  /** Notas seguidas de una región antes de ceder el turno. */
  phraseLength: number
  /** Resuelve cuando la actividad corta cae por debajo de esta fracción de la larga. */
  resolveBelow: number
  /** Vuelve a permitir otra resolución cuando la actividad corta supera esta fracción. */
  resetAbove: number
}

/** Valores elegidos simulando el video completo (ver validate/melody.real.test.ts). */
export const DEFAULT_MELODY: MelodyOptions = { phraseLength: 4, resolveBelow: 0.7, resetAbove: 0.9 }

export class MelodyPlanner {
  private opts: MelodyOptions
  private phraseCount = 0
  constructor(opts: Partial<MelodyOptions> = {}) {
    this.opts = { ...DEFAULT_MELODY, ...opts }
  }
  private voices: Record<Region, VoiceState> = {
    oeste: { idx: 0, lastNeighbors: 0, initialized: false },
    centro: { idx: 0, lastNeighbors: 0, initialized: false },
    este: { idx: 0, lastNeighbors: 0, initialized: false },
  }
  private lastRegion: Region | null = null
  private lastChord = -1
  private shortAvg = -1
  private longAvg = -1
  private resolved = false

  reset() {
    for (const r of Object.keys(this.voices) as Region[]) this.voices[r].initialized = false
    this.lastRegion = null
    this.phraseCount = 0
    this.shortAvg = this.longAvg = -1
    this.resolved = false
  }

  /**
   * Planea un tiempo del pulso.
   * @param sub posición dentro del tiempo (0 = negra … 3)
   * @param pending grupos grandes llegados desde el tiempo anterior
   * @param chordIdx acorde actual de la estación
   */
  planSlot(sub: number, pending: Strike[], chordIdx: number, arrivals = pending.length): { events: NoteEvent[]; group: PlannedGroup | null; resolution: boolean } {
    const events: NoteEvent[] = []
    if (chordIdx !== this.lastChord) {
      // Cambió el acorde: cada voz busca la nota más cercana en la nueva escalera (conducción de voces).
      this.revoice(this.lastChord, chordIdx)
      this.lastChord = chordIdx
    }

    // 6) Resolución en la calma: promedio corto (~1.4 s) vs. promedio largo (~28 s) de grupos grandes.
    // `arrivals` = grupos grandes que LLEGARON en este tiempo (la densidad); `pending` puede incluir
    // grupos que esperan desde tiempos anteriores (SlotQueue).
    const n = arrivals
    if (this.shortAvg < 0) this.shortAvg = this.longAvg = n
    this.shortAvg = this.shortAvg * 0.9 + n * 0.1
    this.longAvg = this.longAvg * 0.995 + n * 0.005
    let resolution = false
    if (!this.resolved && this.longAvg > 1 && this.shortAvg < this.opts.resolveBelow * this.longAvg) {
      this.resolved = true
      resolution = true
      const ladder = regionLadder(chordIdx, 'centro')
      const rootPc = pitchClassOfRoot(chordIdx)
      const root = ladder.find((m) => m % 12 === rootPc) ?? ladder[0]
      events.push({ midi: root, offset: 0, velocity: 0.5, duration: 1.6, pan: 0, timbre: 'campana', role: 'resolucion' })
      // Las voces regresan a la nota base de su registro.
      for (const r of Object.keys(this.voices) as Region[]) {
        const lad = regionLadder(chordIdx, r)
        const i = lad.findIndex((m) => m % 12 === rootPc)
        if (i >= 0) this.voices[r].idx = i
      }
    } else if (this.resolved && this.shortAvg > this.opts.resetAbove * this.longAvg) {
      this.resolved = false
    }

    // En el tiempo fuerte suena cualquier grupo que esté esperando; en las subdivisiones manda la densidad.
    const allowed = pending.length > 0 && (sub === 0 || slotAllows(sub, n))
    if (!allowed) return { events, group: null, resolution }

    // 3) Conversación por frases: la región que tiene el turno sigue mientras tenga rayos grandes y no
    //    haya completado su frase; al terminarla, contesta otra región con rayos grandes.
    const sorted = [...pending].sort((a, b) => priority(b) - priority(a))
    let s = sorted[0]
    if (this.lastRegion) {
      const own = sorted.find((c) => regionOf(c.lon) === this.lastRegion)
      const other = sorted.find((c) => regionOf(c.lon) !== this.lastRegion && priority(c) >= 0.5 * priority(sorted[0]))
      if (this.phraseCount >= this.opts.phraseLength && other) s = other
      else if (own && priority(own) >= 0.5 * priority(sorted[0])) s = own
    }
    const region = regionOf(s.lon)
    const voice = this.voices[region]
    const ladder = regionLadder(chordIdx, region)

    // 1) Pasos: caminar hacia la nota de la latitud.
    const target = latToLadderIndex(s.lat, ladder.length)
    if (!voice.initialized) {
      voice.idx = target
      voice.initialized = true
    } else {
      let step = Math.max(-MAX_STEP, Math.min(MAX_STEP, target - voice.idx))
      if (step === 0) step = voice.idx + 1 < ladder.length ? 1 : -1 // bordar la nota en lugar de repetirla
      voice.idx = Math.max(0, Math.min(ladder.length - 1, voice.idx + step))
    }

    // 5) Arpegio según si la tormenta crece o se encoge en esa región.
    const count = s.neighbors >= 3 ? 3 : s.neighbors >= 1 ? 2 : 1
    const direction: 1 | -1 | 0 = count === 1 ? 0 : s.neighbors >= voice.lastNeighbors ? 1 : -1
    voice.lastNeighbors = s.neighbors
    const chordTones: number[] = []
    for (let k = count - 1; k >= 0; k--) chordTones.push(Math.max(0, voice.idx - k * 2))
    const order = direction === -1 ? [...chordTones].reverse() : chordTones
    const uniq = [...new Set(order)]

    const { velocity, duration } = dynamics(s)
    const pan = lonToPan(s.lon)
    const timbre = s.land ? 'marimba' : 'campana'
    uniq.forEach((li, j) => {
      const isMelody = ladder[li] === ladder[voice.idx]
      events.push({
        midi: ladder[li],
        offset: j * STRUM,
        velocity: velocity * (isMelody ? 1 : 0.75),
        duration,
        pan,
        timbre,
        role: 'melodia',
        lead: isMelody,
      })
    })
    if (s.isNew) {
      events.push({
        midi: Math.min(ladder[voice.idx] + 12, 96),
        offset: 0.06,
        velocity: 0.35,
        duration: 0.6,
        pan,
        timbre: 'campana',
        role: 'acento',
      })
    }

    this.phraseCount = region === this.lastRegion ? this.phraseCount + 1 : 1
    this.lastRegion = region
    return {
      events,
      group: { strike: s, region, direction, notes: uniq.length, midi: ladder[voice.idx] },
      resolution,
    }
  }

  /** Al cambiar de acorde, cada voz se mueve a la nota más cercana del nuevo acorde. */
  private revoice(prevChord: number, nextChord: number) {
    if (prevChord < 0) return
    for (const r of Object.keys(this.voices) as Region[]) {
      const v = this.voices[r]
      if (!v.initialized) continue
      const prev = regionLadder(prevChord, r)
      const next = regionLadder(nextChord, r)
      const current = prev[Math.min(v.idx, prev.length - 1)]
      let best = 0
      for (let i = 1; i < next.length; i++) if (Math.abs(next[i] - current) < Math.abs(next[best] - current)) best = i
      v.idx = best
    }
  }
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function pitchClassOfRoot(chordIdx: number): number {
  return PC[SEASON_CHORDS[chordIdx].tones[0]]
}

/** Cuántos tiempos del pulso puede esperar un grupo grande antes de descartarse (una negra). */
export const CARRY_SLOTS = 4

/**
 * Cola de grupos entre tiempos del pulso.
 *
 * Arregla dos silencios medidos al inicio del video (cuando empiezan a aparecer los rayos):
 *  1. Un grupo grande que llegaba ENTRE dos tiempos fuertes se descartaba. Ahora espera hasta
 *     una negra (CARRY_SLOTS) y suena en el siguiente tiempo permitido.
 *  2. Los primeros rayos son grupos chicos o medianos (< 1000) y nunca tocaban melodía. Ahora, si en
 *     un tiempo fuerte no hay ningún grupo grande, toca el grupo más grande de ese momento (suave,
 *     porque su volumen sigue dependiendo de su tamaño).
 */
export class SlotQueue {
  private big: { s: Strike; slot: number }[] = []
  private fallback: Strike | null = null
  private arrivals = 0
  private slot = 0

  add(s: Strike) {
    if (isMelodic(s)) {
      this.big.push({ s, slot: this.slot })
      this.arrivals++
      if (this.big.length > 48) {
        this.big.sort((a, b) => priority(b.s) - priority(a.s))
        this.big.length = 48
      }
    } else if (!this.fallback || s.energy > this.fallback.energy) {
      this.fallback = s
    }
  }

  /** Candidatos para este tiempo y cuántos grupos grandes llegaron en él. */
  take(sub: number): { candidates: Strike[]; arrivals: number } {
    this.big = this.big.filter((x) => this.slot - x.slot < CARRY_SLOTS)
    let candidates = this.big.map((x) => x.s)
    if (candidates.length === 0 && sub === 0 && this.fallback) candidates = [this.fallback]
    return { candidates, arrivals: this.arrivals }
  }

  /** Cierra el tiempo: si sonó un grupo se vacía la cola; si no, los grandes siguen esperando. */
  endSlot(sub: number, played: boolean) {
    if (played) this.big = []
    if (played || sub === 0) this.fallback = null
    this.arrivals = 0
    this.slot++
  }

  reset() {
    this.big = []
    this.fallback = null
    this.arrivals = 0
  }
}
