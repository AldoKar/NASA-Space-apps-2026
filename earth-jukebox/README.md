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

Todo suena **sobre un pulso** (semicorcheas a 105 BPM) y **dentro del acorde de la estación**,
así que las notas nunca chocan entre sí. Los umbrales salen de medir los 29,963 grupos de rayos del video.

| Capa | Dato del video | Sonido |
|---|---|---|
| **Rayos · melodía** | grupos grandes (≥1000 de amarillo nuevo, ~8 %) | una nota por tiempo, siempre del acorde actual |
| | cuántos grupos grandes llegan | subdivisión: en calma solo negras, luego corcheas, en lo más intenso semicorcheas |
| | grupo que llega entre dos tiempos | espera hasta una negra y suena en el siguiente tiempo permitido |
| | no hay grupos grandes (p. ej. al inicio) | en el tiempo fuerte toca el grupo más grande del momento, suave |
| | latitud | nota más aguda al norte, más grave al sur |
| | longitud | audífono izquierdo / derecho (línea vertical al centro del mapa) |
| | tamaño del grupo | volumen y duración |
| | celdas vecinas activas (tamaño de tormenta) | 1 nota (aislado), 2 notas (1–2 vecinas), arpegio de 3 (3+) |
| | tierra u océano (máscara medida del fondo del mapa) | piano eléctrico suave tipo Rhodes (tierra) · vibráfono (océano) |
| | tormenta nueva (zona y vecinas sin rayos) | campanita aguda de acento |
| **Rayos · textura** | grupos chicos y medianos (~92 %) | 0–2 destellos agudos por tiempo, en notas del acorde |
| **Truenos** | grupos muy grandes (≥2500) | retumbo grave en la nota base del acorde (máx. 1 cada 4 s) |
| **Estaciones** | latitud promedio de todos los rayos | acorde de fondo (Re menor en el sur → Do mayor en el norte) |
| | actividad total | brillo del acorde (filtro) |

### Timbre

Todo es síntesis (sin muestras de audio): funciona sin internet y sin licencias de terceros.
Piano eléctrico FM 1:1 que suena más brillante cuanto más fuerte se toca, vibráfono con trémolo lento,
destellos en notas del acorde, colchón de tres osciladores ligeramente desafinados, coro suave,
eco sincronizado al pulso (corchea con puntillo) y sala amplia.

### Cómo se relacionan las notas entre sí (`src/audio/melody.ts`)

| Regla | Dato de los rayos | Efecto musical |
|---|---|---|
| Voz por región | América · Europa y África · Asia y Oceanía | tres voces (grave, media, aguda), cada una de su lado en los audífonos |
| Movimiento por pasos | latitud | la voz camina hacia el norte (sube) o el sur (baja), máx. 2 notas del acorde por paso |
| Conversación por frases | regiones con grupos grandes a la vez | una región toca hasta 4 notas y contesta otra |
| Arpegio con dirección | la tormenta crece o se encoge (zonas vecinas) | arpegio hacia arriba o hacia abajo |
| Resolución | la actividad cae muy por debajo de su promedio | suena la nota base del acorde y las voces regresan a ella |
| Conducción de voces | cambia la estación (acorde) | cada voz pasa a la nota más cercana del nuevo acorde |

Comparación sobre el video completo (`validate/melody.real.test.ts`): antes, 55 % de los saltos entre
notas eran grandes (>7 semitonos); ahora, dentro de cada voz, solo 2–8 %, con un salto promedio de ~4
semitonos. Las regiones cambian en el 41 % de las notas (frases de 2–3 notas) y hay ~5 resoluciones.

Simulación sobre el video completo (`npm run validate`): ~3 grupos y ~6 notas por segundo; los
silencios van de 76 % en los tramos tranquilos a 43 % en los más intensos.

Limitación honesta: el video no muestra la potencia de cada rayo individual (la NASA indica que
cada punto tiene solo latitud, longitud y hora). Lo que se mide es cuántos rayos aparecen juntos.

**Validación con el video real:** la latitud promedio medida oscila cada año entre
≈ +32° (verano boreal) y ≈ −14° (verano austral): ese es el ciclo de las estaciones que se
escucha en la capa *Estaciones*.

## Diseño

Basado en las guías de Apple (HIG y *Designing Fluid Interfaces*):

- **Dos capas:** el mapa es el contenido; la única superficie de vidrio translúcido es la barra
  de reproducción que flota sobre él (`liquid-glass.md`: el vidrio solo en la capa funcional).
- **Tipografía:** [Aileron](https://www.fontsource.org/fonts/aileron) (CC0), empaquetada con `@fontsource/aileron`; tracking negativo en títulos y ligeramente positivo en texto chico.
- **Un solo acento:** el amarillo del rayo, reservado para la acción principal y los datos.
- **Inspector en listas agrupadas** con interruptores, control segmentado y medidores.
- **Elemento distintivo:** un riel de latitud sobre el borde derecho del mapa marca el centro de
  las tormentas; se ve "respirar" de norte a sur con las estaciones.
- **Movimiento con resortes críticamente amortiguados** (sin rebote), interrumpibles.
- Modo claro y oscuro automáticos; respeta *reduced motion*, *reduced transparency* y *more contrast*.

## Protección contra saturación y fallos

Problemas verificados (reproducidos en Chrome y medidos con el video real):

- **El sonido moría para siempre ante un solo error**: el bucle de análisis no se volvía a armar si
  un cuadro fallaba (por ejemplo, el error de Tone.js *"Start time must be strictly greater than
  previous start time"*). El video seguía, pero el análisis y el audio se detenían hasta recargar.
- **Saturación**: hasta 28 notas/s en los pasajes densos y 54 % de las notas del piano cortando
  otra que seguía sonando (22 notas a la vez con 10 voces).

Correcciones (`src/audio/budget.ts`, `stormEngine.ts`, `useLightningLoop.ts`):

| Corrección | Resultado medido |
|---|---|
| El bucle siempre se vuelve a armar; cada cuadro y cada nota con su propio manejo de errores | un error se cuenta y el sonido sigue |
| Perro guardián: si se reproduce y pasan 1.5 s sin cuadros, reinicia el bucle | probado rompiendo el bucle a propósito |
| Hora de inicio segura por voz (estrictamente creciente, nunca en el pasado) | evita el error de Tone.js |
| Presupuesto por importancia: destellos ≤ 8/s, acentos ≤ 11/s, acompañantes ≤ 14/s, melodía líder y resolución ≤ 18/s | máx. 14 notas/s; se conserva el 100 % de las notas líder y el 97.8 % de la melodía; lo omitido son casi solo destellos |
| Voces por disponibilidad: 20 de piano, 8 de vibráfono | notas que cortan otra: de 54 % a 0.5 % |
| Volumen según densidad (hasta −2 dB) y compresor suave antes del limitador | mismo volumen, la mitad de tiempo pegado al techo |

Regla que se conserva: el presupuesto solo **omite** notas después de que el planificador decide;
nunca las cambia, duplica ni inventa (probado en `budget.test.ts`).

**Diagnóstico:** abre la app con `?debug` al final de la dirección (por ejemplo
`http://localhost:5173/?debug`) para ver notas/s, notas omitidas, errores, reinicios del bucle,
reanudaciones del audio, milisegundos de análisis por cuadro y estado del audio.

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
