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

export function describeMoment(f: FrameFeatures, progressPct: number): string {
  if (f.activity < 0.01) return 'Todavía no hay rayos en el mapa.'
  return (
    `Actividad eléctrica ${activityLabel(f.activity)}. ` +
    `Las tormentas se concentran ${hemisphereLabel(f.meanLat)}, ` +
    `con centro cerca de ${formatLat(f.meanLat)}. ` +
    `${Math.round(f.northShare * 100)} por ciento de los rayos está al norte del ecuador. ` +
    `Vas en el ${Math.round(progressPct)} por ciento del periodo 2017 a 2023.`
  )
}
