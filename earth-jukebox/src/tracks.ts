/**
 * Pistas del jukebox. Cada pista es una visualización del Earth Information Center
 * (NASA Scientific Visualization Studio) con su propio detector y motor de sonido.
 * Para el MVP hay una sola pista; la estructura permite agregar más.
 */
export interface Track {
  id: string
  title: string
  subtitle: string
  videoSrc: string
  /** Inicio y fin del periodo que cubre el video (según la página de la NASA). */
  periodStart: string
  periodEnd: string
  /** Descripción del contenido visual, para lectores de pantalla. */
  visualDescription: string
  source: { label: string; url: string }
}

export const TRACKS: Track[] = [
  {
    id: 'lightning-iss',
    title: 'Tormentas del planeta',
    subtitle: 'Rayos detectados desde la Estación Espacial Internacional, 2017–2023',
    videoSrc: '/video/lightning-2048.mp4',
    periodStart: 'Mar 2017',
    periodEnd: 'Jul 2023',
    visualDescription:
      'Mapa plano del mundo en tonos grises sobre fondo oscuro. Cada punto amarillo es un rayo ' +
      'detectado por el sensor LIS de la Estación Espacial Internacional. Cada cuadro muestra los ' +
      'rayos de los últimos 10 días, así que los puntos aparecen, se quedan unos días y desaparecen. ' +
      'Con las estaciones del año, la mayor parte de las tormentas se desplaza entre el hemisferio ' +
      'norte y el hemisferio sur.',
    source: {
      label: 'NASA SVS #5011 — Lightning Events Detected from the ISS 2017-2023',
      url: 'https://svs.gsfc.nasa.gov/5011/',
    },
  },
]
