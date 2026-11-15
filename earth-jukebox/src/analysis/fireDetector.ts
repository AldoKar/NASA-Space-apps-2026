/**
 * Detector del incendio Dixie — convierte un cuadro del video de la NASA en números.
 *
 * Fuente: "Spread of the Dixie Fire 2021" (NASA SVS #4993). Sobre una foto satelital en 3D:
 *   - puntos/triángulos ROJOS  = detecciones de fuego activo (VIIRS)        → "fuego activo"
 *   - líneas AMARILLO BRILLANTE = posición más reciente del frente del fuego → "frente"
 *   - zona GRIS                = área quemada acumulada                     → "área quemada"
 * A la derecha hay una gráfica (fija en pantalla) y arriba a la izquierda la fecha.
 *
 * Calibrado midiendo el video completo (3068 cuadros) a esta misma resolución:
 *   - rojo del fuego ≈ (236, 24, 21); casi nada del terreno se le parece.
 *   - amarillo del frente ≈ (248, 234, 110); el desierto (≈212, 187, 128) se confundía con un
 *     filtro simple, por eso se exige verde alto y azul muy bajo.
 *   - la barra de escala (también roja y amarilla) aporta ~40 píxeles rojos: se resta.
 *   - desde el segundo 96 el video muestra un resumen con todas las líneas de fuego en colores;
 *     se detecta porque la gráfica se rellena de rojo, y no se cuenta como fuego.
 */

export const FIRE_W = 960
export const FIRE_H = 540

/** Zonas que no son mapa (en fracciones de la imagen). */
const GRAPH_X = 780 / 960 // la gráfica ocupa la franja derecha
const LABEL_X = 160 / 960 // etiqueta de fecha, arriba a la izquierda
const LABEL_Y = 50 / 540

/** Escalas medidas en el video completo. */
const RED_FLOOR = 40 // píxeles rojos de la barra de escala
const RED_FULL = 5000 // fuego activo en los momentos más intensos
const FRONT_FULL = 300 // píxeles del frente en los momentos de mayor avance
const BURNED_FULL = 134_000 // área gris al final (cuando ya está todo el incendio en pantalla)
const RECAP_PIXELS = 300 // relleno rojo en la gráfica → resumen final

export interface FireFeatures {
  /** Fuego activo, 0..1. */
  active: number
  /** Frente del fuego (cuánto avanza ahora), 0..1. */
  front: number
  /** Posición horizontal del frente en pantalla, 0 (izquierda) … 1 (derecha); -1 si no hay. */
  frontX: number
  frontY: number
  /** Posición horizontal del fuego activo, 0..1; -1 si no hay. */
  fireX: number
  fireY: number
  /** Área quemada visible (máximo acumulado), 0..1. */
  burned: number
  /** Crecimiento del área quemada por segundo de video (0..1 aprox.). */
  growth: number
  /** true durante el resumen final del video. */
  recap: boolean
  isReset: boolean
}

export function isFireRed(r: number, g: number, b: number): boolean {
  return r > 170 && g < 80 && b < 80 && r - g > 110
}
export function isFrontYellow(r: number, g: number, b: number): boolean {
  return r > 225 && g > 205 && b < 165 && g - b > 85 && r - g < 40
}
export function isBurnedGray(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx - mn < 14 && mx > 70 && mx < 215
}

export class FireDetector {
  private burnedMax = 0
  private lastBurned = -1
  private lastTime = -1
  private growthAvg = 0

  reset() {
    this.burnedMax = 0
    this.lastBurned = -1
    this.lastTime = -1
    this.growthAvg = 0
  }

  analyze(rgba: Uint8ClampedArray | Uint8Array, videoTime: number, w = FIRE_W, h = FIRE_H): FireFeatures {
    const gx = Math.floor(w * GRAPH_X)
    const lx = Math.floor(w * LABEL_X)
    const ly = Math.floor(h * LABEL_Y)
    let red = 0, rxs = 0, rys = 0
    let yel = 0, yxs = 0, yys = 0
    let burned = 0
    for (let y = 0; y < h; y++) {
      const row = y * w * 4
      for (let x = 0; x < gx; x++) {
        if (y < ly && x < lx) continue
        const i = row + x * 4
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
        if (isFireRed(r, g, b)) {
          red++; rxs += x; rys += y
        } else if (isFrontYellow(r, g, b)) {
          yel++; yxs += x; yys += y
        } else if (isBurnedGray(r, g, b)) {
          burned++
        }
      }
    }
    // Resumen final: la gráfica (franja derecha, zona del trazo) se rellena de rojo/naranja.
    let recapPx = 0
    const gy0 = Math.floor(h * (60 / 540)), gy1 = Math.floor(h * (500 / 540))
    const gx1 = Math.floor(w * (950 / 960))
    for (let y = gy0; y < gy1; y++) {
      const row = y * w * 4
      for (let x = Math.floor(w * (800 / 960)); x < gx1; x++) {
        const i = row + x * 4
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
        if (r > 170 && g < 110 && b < 80 && r - g > 80) recapPx++
      }
    }
    const scale = (w * h) / (FIRE_W * FIRE_H)

    const dt = this.lastTime >= 0 ? videoTime - this.lastTime : 0
    const jumped = this.lastTime < 0 || dt <= 0 || dt > 0.5
    if (jumped) this.burnedMax = 0
    this.burnedMax = Math.max(this.burnedMax, burned)
    let growth = 0
    if (!jumped && this.lastBurned >= 0) {
      const g = Math.max(0, this.burnedMax - this.lastBurned) / BURNED_FULL / dt
      this.growthAvg = this.growthAvg * 0.95 + g * 0.05
      growth = Math.min(1, this.growthAvg * 8) // ~1 en el avance más rápido medido
    } else {
      this.growthAvg = 0
    }
    this.lastBurned = this.burnedMax
    this.lastTime = videoTime

    const recap = recapPx / scale > RECAP_PIXELS
    const redN = red / scale
    return {
      active: recap ? 0 : Math.max(0, Math.min(1, (redN - RED_FLOOR) / RED_FULL)),
      front: recap ? 0 : Math.min(1, yel / scale / FRONT_FULL),
      frontX: yel > 3 ? yxs / yel / gx : -1,
      frontY: yel > 3 ? yys / yel / h : -1,
      fireX: redN > RED_FLOOR ? rxs / red / gx : -1,
      fireY: redN > RED_FLOOR ? rys / red / h : -1,
      burned: Math.min(1, this.burnedMax / scale / BURNED_FULL),
      growth: recap ? 0 : growth,
      recap,
      isReset: jumped,
    }
  }
}
