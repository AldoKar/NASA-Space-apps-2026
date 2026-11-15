/**
 * Pistas de The Earth Symphony. Cada pista es una visualización del Earth Information Center
 * (NASA Scientific Visualization Studio) con su propio detector y motor de sonido.
 */
export type TrackKind = 'lightning' | 'fire'

export interface Track {
  id: string
  kind: TrackKind
  /** Nombre corto para el selector de pistas. */
  short: string
  title: string
  subtitle: string
  videoSrc: string
  /** Proporción del video (ancho / alto). */
  aspect: number
  /** Inicio y fin del periodo que cubre el video (según la página de la NASA). */
  periodStart: string
  periodEnd: string
  /** Descripción del contenido visual, para lectores de pantalla. */
  visualDescription: string
  /** Nota honesta sobre los datos. */
  dataNote: string
  source: { label: string; url: string }
}

export const TRACKS: Track[] = [
  {
    id: 'rayos',
    kind: 'lightning',
    short: 'Tormentas',
    title: 'Tormentas del planeta',
    subtitle: 'Rayos detectados desde la Estación Espacial Internacional, 2017–2023',
    videoSrc: '/video/lightning-2048.mp4',
    aspect: 2,
    periodStart: 'Mar 2017',
    periodEnd: 'Jul 2023',
    visualDescription:
      'Mapa plano del mundo en tonos grises sobre fondo oscuro. Cada punto amarillo es un rayo ' +
      'detectado por el sensor LIS de la Estación Espacial Internacional. Cada cuadro muestra los ' +
      'rayos de los últimos 10 días, así que los puntos aparecen, se quedan unos días y desaparecen. ' +
      'Con las estaciones del año, la mayor parte de las tormentas se desplaza entre el hemisferio ' +
      'norte y el hemisferio sur.',
    dataNote:
      'El sensor LIS solo ve cada zona cuando la Estación Espacial pasa por encima: es una muestra de los rayos del planeta, no un conteo total.',
    source: {
      label: 'NASA SVS #5011 — Lightning Events Detected from the ISS 2017-2023',
      url: 'https://svs.gsfc.nasa.gov/5011/',
    },
  },
  {
    id: 'incendio',
    kind: 'fire',
    short: 'Incendio Dixie',
    title: 'Incendio Dixie, 2021',
    subtitle: '100 días de un incendio en California, detectado por el satélite Suomi-NPP',
    videoSrc: '/video/dixie-fire-720.mp4',
    aspect: 16 / 9,
    periodStart: '14 jul 2021',
    periodEnd: '22 oct 2021',
    visualDescription:
      'Vista 3D de montañas y bosques del norte de California, con el lago Almanor. Los puntos rojos ' +
      'son fuego activo detectado por el sensor VIIRS; las líneas amarillas, la posición más reciente ' +
      'del frente; la zona gris, el área quemada, que crece durante 100 días. La cámara se aleja durante ' +
      'las primeras semanas. A la derecha, una gráfica del área quemada acumulada; arriba a la izquierda, ' +
      'la fecha. Al final, un resumen dibuja todas las líneas del fuego en colores.',
    dataNote:
      'El sensor VIIRS detecta el fuego cada 12 horas. Izquierda y derecha se refieren a la pantalla (la cámara se mueve), y el área quemada es la que se ve en pantalla, relativa al total.',
    source: {
      label: 'NASA SVS #4993 — Spread of the Dixie Fire 2021',
      url: 'https://svs.gsfc.nasa.gov/4993/',
    },
  },
]
