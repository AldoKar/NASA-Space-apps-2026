import { isLandCell } from './landMask'

/**
 * Detector de rayos — convierte un cuadro del video de la NASA en números.
 *
 * Fuente: "Lightning Events Detected from the ISS 2017-2023" (NASA SVS #5011),
 * versión Science On a Sphere: mapa plano del mundo (proyección equirectangular),
 * por lo que cada píxel corresponde siempre a la misma latitud/longitud.
 *
 * El video muestra los rayos como puntos amarillos sobre un mapa gris.
 * Cada cuadro acumula los rayos de los últimos 10 días (ventana móvil),
 * así que un rayo NO es un destello instantáneo: aparece y se queda.
 * Por eso distinguimos dos señales:
 *   - "nuevos": celdas donde el amarillo AUMENTA respecto al cuadro anterior
 *     → rayos recién detectados → percusión (suenan una sola vez).
 *   - "actividad": todo el amarillo visible → actividad de la temporada → fondo.
 */

/** Resolución a la que se analiza cada cuadro (el video original es 4096×2048). */
export const ANALYSIS_W = 1024
export const ANALYSIS_H = 512
/** Tamaño de celda de la cuadrícula de detección, en píxeles de análisis. */
export const CELL = 16
export const GRID_W = ANALYSIS_W / CELL // 64 columnas → 5.6° de longitud cada una
export const GRID_H = ANALYSIS_H / CELL // 32 filas    → 5.6° de latitud cada una

/**
 * "Amarillez" de un píxel. El mapa de fondo, las fronteras y las líneas del
 * ecuador/trópicos son grises (R≈G≈B) → amarillez 0. Los rayos son amarillos
 * (≈ R165 G158 B26) → amarillez alta. El margen de 25 elimina ruido de compresión.
 */
export function yellowness(r: number, g: number, b: number): number {
  const v = (r + g) / 2 - b - 25
  return v > 0 ? v : 0
}

/** Calibrado con el video real: suma total de amarillez en un cuadro muy activo (~1e6). */
const ACTIVITY_FULL_SCALE = 1_000_000
/** Calibrado con el video real: energía de rayos nuevos por segundo de video en temporada alta. */
const NEW_ENERGY_FULL_SCALE = 1_000_000
/** Aumento mínimo de amarillez en una celda para contarlo como rayo nuevo. */
const MIN_CELL_DELTA = 100
/** Una celda no puede volver a disparar antes de este tiempo (segundos de video). */
const CELL_COOLDOWN = 0.35

export interface Strike {
  /** Posición horizontal 0..1 (oeste → este). */
  x: number
  /** Posición vertical 0..1 (norte → sur). */
  y: number
  lat: number
  lon: number
  /** Cuánto aumentó el amarillo en la celda (más grande = más rayos juntos). */
  energy: number
  /** Tamaño del grupo según la energía (umbrales medidos en el video). */
  level: GroupLevel
  /** Celdas vecinas (de 8) que también tienen rayos nuevos en este cuadro → tamaño de la tormenta. */
  neighbors: number
  /** Tormenta nueva: la celda y sus vecinas no tenían rayos visibles antes (≈8.5 % de los eventos). */
  isNew: boolean
  /** true si la celda es tierra (≈88 % de los eventos), false si es océano. */
  land: boolean
}

/**
 * Niveles de tamaño de grupo. Umbrales medidos sobre los 29,963 eventos del video completo:
 *   chico 100–400 (68 %), mediano 400–1000 (24 %), grande 1000–2500 (7.4 %), muy grande >2500 (0.6 %).
 */
export type GroupLevel = 'chico' | 'mediano' | 'grande' | 'muy grande'
export function groupLevel(energy: number): GroupLevel {
  if (energy >= 2500) return 'muy grande'
  if (energy >= 1000) return 'grande'
  if (energy >= 400) return 'mediano'
  return 'chico'
}
/** Por debajo de esto una celda se considera "sin rayos visibles" para detectar tormentas nuevas. */
const QUIET_CELL = 60

export interface FrameFeatures {
  /** Actividad global de los últimos 10 días, 0..1. */
  activity: number
  /** Latitud promedio de los rayos visibles (ponderada por amarillez), en grados. */
  meanLat: number
  /** Proporción de la actividad que está en el hemisferio norte, 0..1. */
  northShare: number
  /** Intensidad de rayos nuevos, 0..1 (por segundo de video). */
  newRate: number
  /** Celdas con rayos nuevos, ordenadas de más a menos energía. */
  strikes: Strike[]
  /** Energía de la celda más fuerte (sirve para detectar tormentas grandes → trueno). */
  peakEnergy: number
  /** true si este cuadro no se comparó con el anterior (inicio o salto en el video). */
  isReset: boolean
}

export function cellLat(gy: number): number {
  return 90 - ((gy + 0.5) / GRID_H) * 180
}
export function cellLon(gx: number): number {
  return -180 + ((gx + 0.5) / GRID_W) * 360
}

export class LightningDetector {
  private prev: Float32Array<ArrayBuffer> | null = null
  private cur: Float32Array<ArrayBuffer> = new Float32Array(GRID_W * GRID_H)
  private cooldownUntil = new Float32Array(GRID_W * GRID_H)
  private active = new Uint8Array(GRID_W * GRID_H)
  private lastTime = -1

  /** Olvida el cuadro anterior (al saltar en el video o reiniciar). */
  reset(): void {
    this.prev = null
    this.cooldownUntil.fill(0)
    this.lastTime = -1
  }

  /**
   * Analiza un cuadro RGBA de ANALYSIS_W×ANALYSIS_H.
   * @param rgba píxeles (como los de CanvasRenderingContext2D.getImageData)
   * @param videoTime tiempo del video en segundos
   */
  analyze(rgba: Uint8ClampedArray | Uint8Array, videoTime: number): FrameFeatures {
    const cells = this.cur
    cells.fill(0)

    let total = 0
    let latWeighted = 0
    let north = 0

    for (let py = 0; py < ANALYSIS_H; py++) {
      const gy = (py / CELL) | 0
      const lat = 90 - ((py + 0.5) / ANALYSIS_H) * 180
      let rowSum = 0
      const rowStart = py * ANALYSIS_W * 4
      for (let px = 0; px < ANALYSIS_W; px++) {
        const i = rowStart + px * 4
        const v = yellowness(rgba[i], rgba[i + 1], rgba[i + 2])
        if (v > 0) {
          rowSum += v
          cells[gy * GRID_W + ((px / CELL) | 0)] += v
        }
      }
      total += rowSum
      latWeighted += rowSum * lat
      if (lat > 0) north += rowSum
    }

    const dt = this.lastTime >= 0 ? videoTime - this.lastTime : 0
    // Si el video saltó (seek) o retrocedió, no comparamos: evitaría una avalancha falsa.
    const jumped = this.prev === null || dt <= 0 || dt > 0.5
    const strikes: Strike[] = []
    let newEnergy = 0
    let peakEnergy = 0

    if (!jumped && this.prev) {
      const prev = this.prev
      // 1) Qué celdas tienen rayos nuevos en este cuadro.
      const active = this.active
      active.fill(0)
      for (let k = 0; k < cells.length; k++) {
        const d = cells[k] - prev[k]
        if (d > MIN_CELL_DELTA) {
          active[k] = 1
          newEnergy += d
        }
      }
      // 2) Cada celda activa (fuera de su tiempo de espera) es un evento.
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          const k = gy * GRID_W + gx
          if (!active[k] || videoTime < this.cooldownUntil[k]) continue
          this.cooldownUntil[k] = videoTime + CELL_COOLDOWN
          const d = cells[k] - prev[k]
          let neighbors = 0
          let quiet = prev[k] < QUIET_CELL
          for (let dy = -1; dy <= 1; dy++) {
            const ny = gy + dy
            if (ny < 0 || ny >= GRID_H) continue
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const nx = (gx + dx + GRID_W) % GRID_W // el mapa da la vuelta en longitud
              const nk = ny * GRID_W + nx
              if (active[nk]) neighbors++
              if (prev[nk] >= QUIET_CELL) quiet = false
            }
          }
          strikes.push({
            x: (gx + 0.5) / GRID_W,
            y: (gy + 0.5) / GRID_H,
            lat: cellLat(gy),
            lon: cellLon(gx),
            energy: d,
            level: groupLevel(d),
            neighbors,
            isNew: quiet,
            land: isLandCell(gx, gy),
          })
          if (d > peakEnergy) peakEnergy = d
        }
      }
      strikes.sort((a, b) => b.energy - a.energy)
    } else {
      this.cooldownUntil.fill(0)
    }

    // Guardamos el cuadro actual como "anterior" (intercambiando buffers).
    if (!this.prev) this.prev = new Float32Array(GRID_W * GRID_H)
    const tmp = this.prev
    this.prev = cells
    this.cur = tmp
    this.lastTime = videoTime

    return {
      activity: Math.min(1, total / ACTIVITY_FULL_SCALE),
      meanLat: total > 0 ? latWeighted / total : 0,
      northShare: total > 0 ? north / total : 0.5,
      newRate: jumped ? 0 : Math.min(1, newEnergy / Math.max(dt, 1 / 120) / NEW_ENERGY_FULL_SCALE),
      strikes,
      peakEnergy,
      isReset: jumped,
    }
  }
}

/** Texto legible de una latitud: 23.4 → "23° N". */
export function formatLat(lat: number): string {
  const a = Math.round(Math.abs(lat))
  if (a === 0) return '0° (equator)'
  return `${a}° ${lat > 0 ? 'N' : 'S'}`
}
