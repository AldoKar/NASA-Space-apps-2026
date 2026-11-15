/**
 * Música del incendio (lógica pura, sin audio: se puede probar).
 *
 * Mismo "idioma" que la pista de rayos, para no reaprender nada:
 *   - lo repentino → percusión      (fuego activo → crepitar; en lo más intenso, un latido grave)
 *   - lo que avanza → melodía       (frente del fuego → voz cálida; más frente = más agudo)
 *   - lo que se acumula → tono grave (área quemada → colchón grave que crece durante 100 días)
 *   - izquierda/derecha → audífonos (lado de la pantalla donde está el frente o el fuego)
 *   - todo sobre un pulso y SOLO con notas del acorde → nunca choca.
 *
 * La armonía sigue la intensidad del fuego, en Re menor: calma (Re menor) → creciendo (Si♭) →
 * intenso (Sol menor) → caos (La 7, la tensión que pide volver). Al bajar, regresa a Re menor.
 */

export const FIRE_BPM = 84
/** Duración de un tiempo del pulso (semicorchea) en segundos. Más lento que los rayos: más solemne. */
export const FIRE_SLOT = 60 / FIRE_BPM / 4

const PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10 }

export const FIRE_CHORDS: { name: string; tones: string[]; minIntensity: number }[] = [
  { name: 'Re menor', tones: ['D', 'F', 'A', 'E'], minIntensity: 0 },
  { name: 'Si♭ mayor 7', tones: ['Bb', 'D', 'F', 'A'], minIntensity: 0.08 },
  { name: 'Sol menor 7', tones: ['G', 'Bb', 'D', 'F'], minIntensity: 0.25 },
  { name: 'La 7', tones: ['A', 'C#', 'E', 'G'], minIntensity: 0.5 },
]

/** Intensidad del fuego (0..1) a partir del fuego activo y del frente. */
export function fireIntensity(active: number, front: number): number {
  return Math.min(1, 0.7 * active + 0.3 * front)
}

/** Acorde según la intensidad, con histéresis (±0.04) para que no tiemble en las fronteras. */
export function fireChordFor(intensity: number, current: number): number {
  let idx = 0
  for (let i = 0; i < FIRE_CHORDS.length; i++) if (intensity >= FIRE_CHORDS[i].minIntensity) idx = i
  if (current >= 0 && idx !== current) {
    const lo = FIRE_CHORDS[current].minIntensity
    const hi = current + 1 < FIRE_CHORDS.length ? FIRE_CHORDS[current + 1].minIntensity : 2
    if (intensity > lo - 0.04 && intensity < hi + 0.04) return current
  }
  return idx
}

/** Notas del acorde (MIDI) entre low y high, de grave a agudo. */
export function fireLadder(chordIdx: number, low: number, high: number): number[] {
  const pcs = FIRE_CHORDS[chordIdx].tones.map((t) => PC[t])
  const out: number[] = []
  for (let m = low; m <= high; m++) if (pcs.includes(m % 12)) out.push(m)
  return out
}

/** Nota grave (bajo) del acorde en la octava 2. */
export function fireBass(chordIdx: number): number {
  return 36 + PC[FIRE_CHORDS[chordIdx].tones[0]] // Do2 = 36
}

/** Registro de la melodía del frente: Sol3–Sol5. */
export const FRONT_RANGE: [number, number] = [55, 79]
export const FRONT_MAX_STEP = 2

/** ¿Suena la melodía del frente en esta subdivisión? Más frente → más notas por tiempo. */
export function frontAllows(sub: number, front: number): boolean {
  if (front < 0.02) return false
  if (sub === 0) return true
  if (sub === 2) return front > 0.25
  return front > 0.5
}

/** Siguiente posición en la escalera: camina hacia la altura del frente (más frente = más agudo). */
export function nextFrontIndex(front: number, ladderLength: number, current: number): number {
  const target = Math.min(ladderLength - 1, Math.floor(Math.min(0.9999, front * 1.4) * ladderLength))
  if (current < 0) return target
  let step = Math.max(-FRONT_MAX_STEP, Math.min(FRONT_MAX_STEP, target - current))
  if (step === 0) step = current + 1 < ladderLength ? 1 : -1 // bordar en lugar de repetir
  return Math.max(0, Math.min(ladderLength - 1, current + step))
}

/** Chispazos de crepitar por tiempo según el fuego activo (0–3). */
export function crackleCount(sub: number, active: number): number {
  if (active < 0.01) return 0
  const n = Math.round(active * 3)
  if (n === 0) return sub === 0 ? 1 : 0 // aunque sea poco fuego, se oye en el tiempo fuerte
  return n
}

/** Latido grave en el tiempo fuerte cuando el fuego es muy intenso. */
export function heartbeat(sub: number, active: number): boolean {
  return sub === 0 && active > 0.45
}

/** Paneo progresivo desde la posición horizontal en pantalla (0..1): centro = centro. */
export function screenToPan(x: number): number {
  const s = Math.max(-1, Math.min(1, x * 2 - 1))
  return Math.sign(s) * Math.pow(Math.abs(s), 0.6)
}

export type FirePhase = 'calma' | 'creciendo' | 'intenso' | 'caos' | 'bajando' | 'resumen'

/** Fase en palabras, a partir de la intensidad suavizada y su tendencia. */
export function firePhase(intensity: number, trend: number, recap: boolean): FirePhase {
  if (recap) return 'resumen'
  if (intensity < 0.06) return 'calma'
  if (intensity >= 0.5) return 'caos'
  if (trend > 0.01) return 'creciendo'
  if (trend < -0.01) return 'bajando'
  return intensity >= 0.25 ? 'intenso' : 'creciendo'
}
