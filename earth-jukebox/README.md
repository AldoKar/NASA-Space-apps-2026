# Earth Jukebox — Tormentas del planeta

Sonificación accesible de una visualización del **NASA Earth Information Center**:
los rayos detectados por el sensor LIS de la Estación Espacial Internacional (2017–2023)
se convierten en música **leyendo los píxeles del video en tiempo real**.

> Reto NASA Space Apps 2026 — *Earth Jukebox*.

## Cómo correrlo

```bash
npm install
npm run dev        # abre http://localhost:5173
```

El video web ya está en `public/video/lightning-2048.mp4` (22 MB). Si hace falta regenerarlo
a partir del original de la NASA (334 MB):

```bash
bash scripts/prepare-video.sh ../iss_lightning_sos_yearly_07312023_2048p60.mp4
```

Otros comandos: `npm run build`, `npm test` (pruebas del detector),
`npm run validate` (analiza el video completo; requiere ffmpeg).

## Cómo funciona

```
video NASA ──► canvas oculto 1024×512 ──► detector (píxeles → números) ──► Tone.js (números → sonido)
                                                      │
                                                      └──► interfaz: anillos, indicadores, anuncios
```

1. **Fuente:** versión *Science On a Sphere* del video NASA SVS #5011. Es un mapa plano
   (equirectangular) y la cámara **no se mueve**: cada píxel es siempre la misma latitud/longitud.
2. **Detector** (`src/analysis/detector.ts`): mide la "amarillez" de cada píxel
   (`(R+G)/2 − B`). El mapa y las líneas son grises → 0; los rayos son amarillos → alto.
   El mundo se divide en una cuadrícula de 64×32 celdas.
3. **Ventana de 10 días:** cada cuadro muestra los rayos de los últimos 10 días, así que un
   punto se queda en pantalla varios cuadros. Por eso:
   - **Rayos nuevos** = celdas donde el amarillo *aumenta* respecto al cuadro anterior → suenan una sola vez.
   - **Actividad** = todo el amarillo visible → controla el fondo.

## Reglas de sonificación

| Capa | Dato visual | Sonido |
|---|---|---|
| **Rayos** | celda con rayos nuevos | nota tipo campana eléctrica (escala pentatónica de Re menor) |
| | latitud | altura: norte = agudo, sur = grave |
| | longitud | paneo: oeste = izquierda, este = derecha |
| | cantidad de rayos nuevos | notas por segundo (≈2 a 12) + chisporroteo de fondo |
| **Truenos** | grupo grande de rayos en una celda | retumbo grave con 0.25–0.6 s de retraso |
| **Estaciones** | latitud promedio de todos los rayos | acorde de fondo (Re menor en el sur → Do mayor en el norte) |
| | actividad total | brillo del acorde (filtro) |

**Validación con el video real:** la latitud promedio medida oscila cada año entre
≈ +32° (verano boreal) y ≈ −14° (verano austral): ese es el ciclo de las estaciones que se
escucha en la capa *Estaciones*.

## Accesibilidad

- Todo se controla con teclado: `Espacio` reproducir/pausa, `1` `2` `3` capas,
  `D` describir este momento, `←` `→` ±5 s, `R` reiniciar.
- Región ARIA *live*: anuncia cambios de actividad y de hemisferio (se puede desactivar).
- Botón **Describir este momento**: descripción en palabras del estado actual.
- Descripción textual de la visualización, enlace "saltar a controles", foco visible,
  respeta `prefers-reduced-motion`.

## Notas honestas sobre los datos

- La NASA indica que la versión SOS cubre **marzo 2017 – julio 2023**, pero no publica la
  equivalencia exacta cuadro → fecha, así que la app muestra el avance en el periodo sin
  inventar fechas por cuadro.
- El sensor LIS solo ve cada zona cuando la ISS pasa por encima: es una **muestra** de los
  rayos del planeta, no un conteo total.

## Fuente

NASA Scientific Visualization Studio — *Lightning Events Detected from the ISS 2017-2023*,
https://svs.gsfc.nasa.gov/5011/
