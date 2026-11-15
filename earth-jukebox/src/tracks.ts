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
    short: 'Storms',
    title: 'Storms of the planet',
    subtitle: 'Lightning detected from the International Space Station, 2017–2023',
    videoSrc: '/video/lightning-2048.mp4',
    aspect: 2,
    periodStart: 'Mar 2017',
    periodEnd: 'Jul 2023',
    visualDescription:
      'Flat world map in shades of gray on a dark background. Each yellow dot is a lightning flash ' +
      'detected by the LIS sensor on the International Space Station. Each frame shows the last 10 ' +
      'days of lightning, so dots appear, stay for a few days and fade away. With the seasons, most ' +
      'storms move between the northern and southern hemispheres.',
    dataNote:
      'The LIS sensor only sees each area when the Space Station passes overhead: it is a sample of the planet’s lightning, not a full count.',
    source: {
      label: 'NASA SVS #5011 — Lightning Events Detected from the ISS 2017-2023',
      url: 'https://svs.gsfc.nasa.gov/5011/',
    },
  },
  {
    id: 'incendio',
    kind: 'fire',
    short: 'Dixie Fire',
    title: 'Dixie Fire, 2021',
    subtitle: '100 days of a California wildfire, detected by the Suomi-NPP satellite',
    videoSrc: '/video/dixie-fire-720.mp4',
    aspect: 16 / 9,
    periodStart: 'Jul 14, 2021',
    periodEnd: 'Oct 22, 2021',
    visualDescription:
      '3D view of the mountains and forests of Northern California, with Lake Almanor. Red dots are ' +
      'active fire detected by the VIIRS sensor; yellow lines, the latest position of the fire front; ' +
      'the gray area, the burned area, which grows over 100 days. The camera zooms out during the first ' +
      'weeks. On the right, a chart of the cumulative burned area; at the top left, the date. At the end, ' +
      'a recap draws all the fire lines in color.',
    dataNote:
      'The VIIRS sensor detects fire every 12 hours. Left and right refer to the screen (the camera moves), and the burned area is what is visible on screen, relative to the total.',
    source: {
      label: 'NASA SVS #4993 — Spread of the Dixie Fire 2021',
      url: 'https://svs.gsfc.nasa.gov/4993/',
    },
  },
]
