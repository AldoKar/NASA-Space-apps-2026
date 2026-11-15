import { formatLat, type FrameFeatures } from './analysis/detector'

/** Etiquetas en palabras para lectores de pantalla y para la interfaz. */
export function activityLabel(a: number): 'baja' | 'media' | 'alta' {
  if (a < 0.3) return 'baja'
  if (a < 0.6) return 'media'
  return 'alta'
}

export function hemisphereLabel(lat: number): string {
  if (lat > 8) return 'en el hemisferio norte'
  if (lat < -4) return 'en el hemisferio sur'
  return 'cerca del ecuador'
}

/** Lado de los audífonos según el balance (-1..1), con la región del mapa que le corresponde. */
export function sideLabel(balance: number | null): string {
  if (balance === null) return 'sin rayos nuevos'
  if (balance < -0.34) return 'izquierda · América'
  if (balance > 0.52) return 'derecha · Asia y Oceanía'
  return 'centro · Europa y África'
}

export function describeMoment(f: FrameFeatures, progressPct: number, balance: number | null = null): string {
  if (f.activity < 0.01) return 'Todavía no hay rayos en el mapa.'
  const side = balance === null ? '' : `Los rayos nuevos suenan hacia la ${sideLabel(balance).replace(' · ', ', sobre ')}. `
  return (
    `Actividad eléctrica ${activityLabel(f.activity)}. ` +
    `Las tormentas se concentran ${hemisphereLabel(f.meanLat)}, ` +
    `con centro cerca de ${formatLat(f.meanLat)}. ` +
    `${Math.round(f.northShare * 100)} por ciento de los rayos está al norte del ecuador. ` +
    side +
    `Vas en el ${Math.round(progressPct)} por ciento del periodo 2017 a 2023.`
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
}): string {
  if (opts.phase === 'resumen') return `Resumen final del incendio, 22 de octubre de 2021. Ya no hay fuego activo.`
  const level = (v: number) => (v < 0.05 ? 'casi nulo' : v < 0.25 ? 'bajo' : v < 0.5 ? 'medio' : 'alto')
  const side = opts.frontX < 0 ? '' : opts.frontX < 0.4 ? ', avanzando por la izquierda de la pantalla' : opts.frontX > 0.6 ? ', avanzando por la derecha de la pantalla' : ', avanzando por el centro'
  return (
    `${opts.date}, día ${Math.round(opts.day)} de 100. Fase: ${opts.phase}. ` +
    `Fuego activo ${level(opts.active)}. Frente ${level(opts.front)}${opts.front >= 0.05 ? side : ''}. ` +
    `Área quemada: ${Math.round(opts.burned * 100)} por ciento de la que se verá al final.`
  )
}
