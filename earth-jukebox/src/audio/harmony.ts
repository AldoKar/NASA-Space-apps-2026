import type { Strike } from '../analysis/detector'

/**
 * Armonía y ritmo de la capa de rayos (lógica pura, sin audio: se puede probar).
 *
 * Reglas:
 *  1. Las notas de los rayos salen SIEMPRE del acorde de la estación que suena de fondo
 *     → nunca chocan con él.
 *  2. Todo cae en un pulso (semicorcheas a 105 BPM): los rayos esperan al siguiente tiempo.
 *  3. Solo los grupos grandes (≥1000, ~8 % de los eventos) tocan melodía; uno por tiempo.
 *     Los chicos y medianos (~92 %) se vuelven textura de fondo.
 *  3b. La intensidad decide la subdivisión rítmica (slotAllows): en calma solo suenan los
 *     tiempos fuertes (negras), con más actividad las corcheas y en lo más intenso las semicorcheas.
 *  4. El tamaño de la tormenta (celdas vecinas activas) decide cuántas notas: sola, doble o arpegio.
 */

export const BPM = 105
/** Duración de un tiempo del pulso (semicorchea) en segundos. */
export const SLOT = 60 / BPM / 4
/** Separación entre las notas de un arpegio, en segundos. */
export const STRUM = 0.045
/** Máximo de grupos melódicos por tiempo. */
export const MAX_MELODIC_PER_SLOT = 1

/**
 * ¿Puede sonar melodía en esta subdivisión del pulso?
 * `sub` = posición dentro del tiempo (0 = negra, 2 = corchea a contratiempo, 1 y 3 = semicorcheas).
 * `candidates` = grupos grandes detectados desde el tiempo anterior. Umbrales medidos en el video:
 *   ≥1 ocurre el 92 % de las veces, ≥4 el 48 %, ≥7 el ~12 %.
 */
export function slotAllows(sub: number, candidates: number): boolean {
  if (candidates <= 0) return false
  if (sub === 0) return true
  if (sub === 2) return candidates >= 4
  return candidates >= 7
}

/**
 * Acordes del fondo, de sur a norte. Todos son diatónicos a Do mayor / Re dórico,
 * así que también suenan bien mientras uno se apaga y entra el siguiente.
 * La latitud promedio medida en el video oscila aprox. entre -14° y +32°.
 */
export const SEASON_CHORDS: { maxLat: number; notes: string[]; tones: string[]; name: string }[] = [
  { maxLat: -8, notes: ['D2', 'A2', 'F3', 'C4'], tones: ['D', 'F', 'A', 'C'], name: 'Re menor' },
  { maxLat: 4, notes: ['F2', 'C3', 'A3', 'E4'], tones: ['F', 'A', 'C', 'E'], name: 'Fa mayor' },
  { maxLat: 16, notes: ['G2', 'D3', 'A3', 'F4'], tones: ['G', 'A', 'D', 'F'], name: 'Sol suspendido' },
  { maxLat: 26, notes: ['A2', 'E3', 'C4', 'G4'], tones: ['A', 'C', 'E', 'G'], name: 'La menor' },
  { maxLat: 999, notes: ['C3', 'G3', 'E4', 'D5'], tones: ['C', 'D', 'E', 'G'], name: 'Do mayor' },
]

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNote(m: number): string {
  return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
}

/** Notas del acorde ordenadas de grave a agudo, entre Re3 (50) y Mi6 (88): la "escalera" de la melodía. */
export function chordLadder(chordIdx: number, low = 50, high = 88): number[] {
  const pcs = SEASON_CHORDS[chordIdx].tones.map((t) => PITCH_CLASS[t])
  const out: number[] = []
  for (let m = low; m <= high; m++) if (pcs.includes(m % 12)) out.push(m)
  return out
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

const LAT_MIN = -50
const LAT_MAX = 50

/** Latitud → posición en la escalera del acorde (norte = agudo). Evita repetir la nota anterior. */
export function latToLadderIndex(lat: number, ladderLength: number, lastIndex = -1): number {
  const t = Math.max(0, Math.min(0.9999, (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)))
  let i = Math.floor(t * ladderLength)
  if (i === lastIndex) i = i + 1 < ladderLength ? i + 1 : i - 1
  return i
}

/**
 * Tamaño de la tormenta → notas (posiciones en la escalera, hacia abajo desde la melodía):
 *   aislado (0 vecinas)   → 1 nota
 *   1–2 vecinas           → 2 notas (la melodía y la nota del acorde de abajo)
 *   3 o más vecinas       → arpegio de 3 notas
 */
export function voicing(rootIndex: number, neighbors: number): number[] {
  const n = neighbors >= 3 ? 3 : neighbors >= 1 ? 2 : 1
  const out: number[] = []
  for (let k = n - 1; k >= 0; k--) {
    const i = rootIndex - k * 2 // saltar de dos en dos en la escalera = intervalos amplios y abiertos
    out.push(i >= 0 ? i : rootIndex)
  }
  return [...new Set(out)] // arpegio ascendente, sin duplicados
}

/** ¿Este evento toca melodía? Solo grupos grandes o muy grandes. */
export function isMelodic(s: Strike): boolean {
  return s.level === 'grande' || s.level === 'muy grande'
}

/** Prioridad para elegir qué grupos suenan en un tiempo: tormenta nueva > océano (raro) > energía. */
export function priority(s: Strike): number {
  return s.energy + (s.isNew ? 3000 : 0) + (s.land ? 0 : 1500)
}

/** Elige hasta `max` grupos para un tiempo, evitando dos del mismo lugar. */
export function pickForSlot(candidates: Strike[], max = MAX_MELODIC_PER_SLOT): Strike[] {
  const sorted = [...candidates].sort((a, b) => priority(b) - priority(a))
  const out: Strike[] = []
  for (const s of sorted) {
    if (out.length >= max) break
    if (out.every((o) => Math.abs(o.x - s.x) > 0.06 || Math.abs(o.y - s.y) > 0.1)) out.push(s)
  }
  return out
}

/** Volumen (0..1) y duración (s) de la nota según el tamaño del grupo. */
export function dynamics(s: Strike): { velocity: number; duration: number } {
  if (s.level === 'muy grande') return { velocity: 0.95, duration: 0.9 }
  const t = Math.max(0, Math.min(1, (s.energy - 1000) / 1500))
  return { velocity: 0.45 + t * 0.35, duration: 0.3 + t * 0.35 }
}

/**
 * Textura: cuántos "chispazos" suaves por tiempo, según la cantidad de grupos chicos y medianos.
 * Medido: ~23 eventos por tiempo en momentos tranquilos y ~70 en los intensos.
 */
export function textureTicks(smallCount: number): number {
  if (smallCount <= 0) return 0
  return Math.max(0, Math.min(2, Math.round((smallCount - 25) / 20)))
}
