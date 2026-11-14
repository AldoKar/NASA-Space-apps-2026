/**
 * Control de saturación (lógica pura, sin audio: se puede probar).
 *
 * Medido con el video real (validate/saturation.real.test.ts), sin control:
 *   - hasta 28 notas/s en los pasajes más densos (mediana 12, p90 21), contando destellos;
 *   - el piano eléctrico llegaba a 22 notas sonando a la vez con 10 voces → 54 % de las notas
 *     cortaban otra que seguía sonando.
 *
 * Regla: todo esto actúa DESPUÉS de que el planificador decide las notas. Solo puede omitir notas,
 * nunca inventarlas, duplicarlas ni cambiarlas, así que la melodía sigue sin repetirse.
 */

/** Tope suave (notas/s): los destellos solo entran mientras el total esté por debajo de esto. */
export const SOFT_CAP = 8
/** Tope duro (notas/s): nadie lo pasa. Solo resolución y melodía líder llegan hasta aquí. */
export const HARD_CAP = 18
/** Las notas con esta importancia o más pueden llegar al tope duro. */
export const ESSENTIAL_RANK = 90

/**
 * Tope por importancia: cuanto menos importante la nota, antes deja de entrar.
 * Así los destellos ceden su lugar a la melodía en vez de llenar el presupuesto.
 * (Con un tope único de 12, medido con el video real, la melodía perdía el 18 % de sus notas.)
 */
export function capFor(rank: number): number {
  if (rank >= ESSENTIAL_RANK) return HARD_CAP // resolución, líder
  if (rank >= 60) return 14 // acompañante del arpegio
  if (rank >= 40) return 11 // acento de tormenta nueva
  return SOFT_CAP // destellos
}

export type NoteRole = 'resolucion' | 'lider' | 'acompanante' | 'acento' | 'destello'

/** Importancia de cada tipo de nota: lo primero que se sacrifica son los destellos. */
export function rankOf(role: NoteRole): number {
  switch (role) {
    case 'resolucion': return 100
    case 'lider': return 90
    case 'acompanante': return 60
    case 'acento': return 40
    case 'destello': return 10
  }
}

/** Presupuesto de notas en una ventana deslizante de 1 segundo (en tiempo de audio). */
export class NoteBudget {
  private times: number[] = []
  dropped = 0
  admitted = 0

  /** ¿Puede sonar una nota de esta importancia a esta hora? Si sí, la cuenta. */
  admit(time: number, rank: number): boolean {
    // Quitar las que ya salieron de la ventana [time-1, time] (y las "del futuro" tras un reinicio).
    this.times = this.times.filter((x) => x > time - 1 && x <= time + 1)
    const used = this.times.filter((x) => x > time - 1).length
    const cap = capFor(rank)
    if (used >= cap) {
      this.dropped++
      return false
    }
    this.times.push(time)
    this.admitted++
    return true
  }

  /** Notas admitidas en el último segundo antes de `time`. */
  recent(time: number): number {
    return this.times.filter((x) => x > time - 1 && x <= time).length
  }

  reset() {
    this.times = []
  }
}

/** Volumen relativo según la densidad reciente: 1 con poca densidad, baja hasta 0.7 en lo más denso. */
export function densityGain(notesLastSecond: number): number {
  if (notesLastSecond <= 8) return 1
  const t = Math.min(1, (notesLastSecond - 8) / (HARD_CAP - 8))
  return 1 - t * 0.3
}

/**
 * Elige la voz para una nota: una libre (la que lleva más tiempo libre) o, si todas suenan,
 * la que va a terminar antes (así se corta lo que ya casi no se oye).
 * @param busyUntil hora (s) hasta la que suena cada voz
 */
export function pickVoice(busyUntil: number[], time: number): number {
  let freeBest = -1
  let soonest = 0
  for (let i = 0; i < busyUntil.length; i++) {
    if (busyUntil[i] <= time && (freeBest < 0 || busyUntil[i] < busyUntil[freeBest])) freeBest = i
    if (busyUntil[i] < busyUntil[soonest]) soonest = i
  }
  return freeBest >= 0 ? freeBest : soonest
}

/**
 * Hora de inicio segura para una voz: estrictamente mayor que su inicio anterior y nunca en el
 * pasado. Evita el error de Tone.js "Start time must be strictly greater than previous start time".
 */
export function safeStart(time: number, lastStart: number, currentTime: number, epsilon = 0.002): number {
  return Math.max(time, currentTime + epsilon, lastStart + epsilon)
}
