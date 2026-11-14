/**
 * Mapa → audífonos.
 * El mapa se parte con una línea vertical al centro (longitud 0°):
 *   borde izquierdo (180° O) → solo audífono izquierdo  (-1)
 *   centro (0°)              → ambos por igual           ( 0)
 *   borde derecho (180° E)   → solo audífono derecho    (+1)
 *
 * La curva es progresiva (exponente < 1) para que regiones como América (-60° a -100°)
 * o Asia (+80° a +140°) se escuchen claramente de su lado, manteniendo el centro en el centro
 * y el orden: más a la izquierda en el mapa = siempre más a la izquierda en el oído.
 */
const PAN_CURVE = 0.6

export function lonToPan(lon: number): number {
  const s = Math.max(-1, Math.min(1, lon / 180))
  return Math.sign(s) * Math.pow(Math.abs(s), PAN_CURVE)
}

/** Balance izquierda/derecha de un grupo de rayos (ponderado por energía), -1..1. */
export function balanceOf(strikes: { lon: number; energy: number }[]): number | null {
  let sum = 0
  let w = 0
  for (const s of strikes) {
    sum += lonToPan(s.lon) * s.energy
    w += s.energy
  }
  return w > 0 ? sum / w : null
}
