import { formatLat, type FrameFeatures } from './analysis/detector'

/** Etiquetas en palabras para lectores de pantalla y para la interfaz. */
export function activityLabel(a: number): 'low' | 'medium' | 'high' {
  if (a < 0.3) return 'low'
  if (a < 0.6) return 'medium'
  return 'high'
}

export function hemisphereLabel(lat: number): string {
  if (lat > 8) return 'in the northern hemisphere'
  if (lat < -4) return 'in the southern hemisphere'
  return 'near the equator'
}

/** Lado de los audífonos según el balance (-1..1), con la región del mapa que le corresponde. */
export function sideLabel(balance: number | null): string {
  if (balance === null) return 'no new lightning'
  if (balance < -0.34) return 'left · Americas'
  if (balance > 0.52) return 'right · Asia and Oceania'
  return 'center · Europe and Africa'
}

export function describeMoment(f: FrameFeatures, progressPct: number, balance: number | null = null): string {
  if (f.activity < 0.01) return 'No lightning on the map yet.'
  const [dir, region] = sideLabel(balance).split(' · ')
  const side = balance === null ? '' : `New lightning sounds ${dir === 'center' ? 'in the center' : `on the ${dir}`}, over ${region}. `
  return (
    `${activityLabel(f.activity)[0].toUpperCase()}${activityLabel(f.activity).slice(1)} lightning activity. ` +
    `Storms are concentrated ${hemisphereLabel(f.meanLat)}, ` +
    `centered near ${formatLat(f.meanLat)}. ` +
    `${Math.round(f.northShare * 100)} percent of the lightning is north of the equator. ` +
    side +
    `You are ${Math.round(progressPct)} percent through the 2017 to 2023 period.`
  )
}

/** Descripción en palabras del momento del incendio, para lectores de pantalla. */
export function describeFire(opts: {
  date: string
  day: number
  phase: string
  active: number
  front: number
  frontX: number
  burned: number
  areaKm2: number
}): string {
  if (opts.phase === 'resumen') return `Final recap of the fire, October 22, 2021. There is no active fire anymore.`
  const level = (v: number) => (v < 0.05 ? 'almost none' : v < 0.25 ? 'low' : v < 0.5 ? 'medium' : 'high')
  const side = opts.frontX < 0 ? '' : opts.frontX < 0.4 ? ', advancing on the left of the screen' : opts.frontX > 0.6 ? ', advancing on the right of the screen' : ', advancing in the center'
  return (
    `${opts.date}, day ${Math.round(opts.day)} of 100. Phase: ${opts.phase}. ` +
    `Active fire: ${level(opts.active)}. Fire front: ${level(opts.front)}${opts.front >= 0.05 ? side : ''}. ` +
    `Burned area: about ${(Math.round(opts.areaKm2 / 10) * 10).toLocaleString('en-US')} square kilometers, ${Math.round(opts.burned * 100)} percent of the final total.`
  )
}
