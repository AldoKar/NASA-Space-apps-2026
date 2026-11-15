/**
 * Línea de tiempo del video del incendio Dixie: día del incendio (0 = 14 de julio de 2021,
 * 100 = 22 de octubre de 2021) para cada segundo del video.
 *
 * Se obtuvo de la FECHA QUE MUESTRA EL PROPIO VIDEO (esquina superior izquierda), leída con OCR
 * dos veces por segundo. Las lecturas se limpiaron: se descartaron las que contradecían a sus
 * vecinas y se forzó que la fecha nunca retroceda; la mayor diferencia con lo leído es de 1.3 días.
 * El video NO avanza parejo: ~0.8 días por segundo hasta septiembre y mucho más rápido después.
 * Desde el segundo ~94 el video está en el 22 de octubre y a partir del 96 muestra un resumen.
 */
const DAY_BY_SECOND = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2.2, 2.8, 3.5, 4.5, 5.0, 6.0, 7.0, 8.0, 8.5, 9.5, 10.2, 11.0, 12.0, 13.0, 13.5, 14.3, 15.7, 16.0, 16.8, 17.8, 18.8, 19.5, 20.5, 21.0, 22.0, 23.0, 23.5, 24.5, 25.2, 25.3, 27.2, 28.0, 29.0, 29.5, 30.5, 31.0, 32.0, 33.0, 33.5, 34.5, 35.5, 36.5, 37.0, 38.0, 39.0, 39.5, 40.5, 41.5, 42.0, 43.2, 44.0, 44.5, 45.5, 46.5, 47.0, 48.2, 49.2, 49.8, 50.5, 51.5, 52.0, 53.0, 54.2, 55.0, 55.5, 56.5, 57.5, 58.0, 59.0, 60.5, 63.0, 65.5, 67.5, 70.5, 72.8, 75.5, 77.5, 80.5, 82.5, 85.0, 87.5, 90.0, 92.5, 95.0, 97.5, 99.5, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0]

export const FIRE_START = new Date(2021, 6, 14)
export const FIRE_DAYS = 100

/** Día del incendio (0–100, con decimales) para un tiempo del video en segundos. */
export function fireDay(videoTime: number): number {
  const t = Math.max(0, Math.min(DAY_BY_SECOND.length - 1, videoTime))
  const i = Math.floor(t)
  const j = Math.min(i + 1, DAY_BY_SECOND.length - 1)
  return DAY_BY_SECOND[i] + (DAY_BY_SECOND[j] - DAY_BY_SECOND[i]) * (t - i)
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "21 jul 2021" */
export function fireDateLabel(day: number): string {
  const d = new Date(FIRE_START)
  d.setDate(d.getDate() + Math.round(day))
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
