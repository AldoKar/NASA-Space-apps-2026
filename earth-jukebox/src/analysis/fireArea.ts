import { fireDay } from './fireTimeline'

/**
 * Área quemada del incendio Dixie leída de la GRÁFICA del propio video de la NASA ("Area, km²
 * vs Days", franja derecha). Se midió la altura del relleno gris columna por columna en un cuadro
 * donde la curva ya está completa (segundo 88) y se pasó a km² con las marcas del eje (300 km²
 * = 43 px a 720p). Un valor por día del incendio: 0 = 14 de julio de 2021 … 100 = 22 de octubre.
 *
 * A diferencia de contar píxeles grises del mapa, esto no cambia cuando la cámara se acerca o se
 * mueve, nunca baja y funciona igual al adelantar o regresar el video.
 * La curva de la gráfica se aplana cerca de 3,680 km² a partir de mediados de septiembre.
 */
export const AREA_BY_DAY = [
  0, 30, 60, 80, 90, 240, 350, 450, 510, 740, 900, 950, 950, 980, 1060, 1070, 1120, 1120, 1130,
  1140, 1170, 1230, 1800, 2040, 2080, 2420, 2530, 2540, 2540, 2560, 2570, 2570, 2780, 2820, 2860,
  2980, 3090, 3100, 3110, 3140, 3170, 3200, 3240, 3270, 3320, 3340, 3380, 3480, 3510, 3520, 3520,
  3530, 3530, 3540, 3560, 3570, 3610, 3630, 3640, 3640, 3640, 3640, 3640, 3660, 3680,
]

/** Área final según la gráfica (km²). */
export const AREA_FINAL = AREA_BY_DAY[AREA_BY_DAY.length - 1]

/** Crecimiento más rápido de la gráfica (km² por día, promedio de 2 días): 5 de agosto. */
const GROWTH_MAX = 400

/** Área quemada (km²) en un día del incendio, con decimales. */
export function areaOnDay(day: number): number {
  const last = AREA_BY_DAY.length - 1
  if (day >= last) return AREA_FINAL
  if (day <= 0) return 0
  const i = Math.floor(day)
  return AREA_BY_DAY[i] + (AREA_BY_DAY[i + 1] - AREA_BY_DAY[i]) * (day - i)
}

/** Cuánto crece el área ese día (km²/día), promediando el día anterior y el siguiente. */
export function growthOnDay(day: number): number {
  return Math.max(0, (areaOnDay(day + 1) - areaOnDay(day - 1)) / 2)
}

export interface FireArea {
  /** km² quemados hasta ahora. */
  km2: number
  /** Fracción del área final, 0..1. */
  fraction: number
  /** Qué tan rápido crece ahora, 0..1 (1 = el día de mayor avance). */
  growth: number
}

/** Área quemada para un tiempo del video (segundos). */
export function fireAreaAt(videoTime: number): FireArea {
  const day = fireDay(videoTime)
  const km2 = areaOnDay(day)
  return {
    km2,
    fraction: km2 / AREA_FINAL,
    growth: Math.min(1, growthOnDay(day) / GROWTH_MAX),
  }
}
