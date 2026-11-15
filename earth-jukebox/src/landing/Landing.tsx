import { PixelCanvas } from './PixelCanvas'
import { PixelCanvasBackground } from './PixelCanvasBackground'
import './Landing.css'

/**
 * Landing de The Earth Symphony: un recorrido de cuatro secciones que lleva a la app.
 * Estructura adaptada de la landing de CareMap (hero de píxeles con título en bloque de color,
 * subtítulo en bloque blanco, botón píxel, y tarjetas a dos columnas), en azul y negro.
 */

function goTo(id: string) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
}

export default function Landing() {
  return (
    <div className="lp">
      <a className="lp-skip" href="/symphony">Saltar a The Earth Symphony</a>

      <main className="lp-col">
        {/* ── La pregunta ── */}
        <section id="acto-1" className="lp-act lp-hero" aria-labelledby="t1">
          <PixelCanvas src="/video/lightning-2048.mp4" startAt={40} pixelSize={6} gain={1.6} />
          <div className="lp-hero-inner">
            <h1 id="t1" className="lp-title">
              <span>¿Te has imaginado cómo suenan los fenómenos naturales?</span>
            </h1>
            <p className="lp-sub">
              Rayos e incendios vistos desde el espacio por la NASA, convertidos en música. Accesible y manos libres: no necesitas ver la pantalla, solo escuchar.
            </p>
            <div className="lp-ctas">
              <button type="button" className="lp-pill" onClick={() => goTo('acto-2')}>
                Empezar el recorrido ›
              </button>
              <a className="lp-ghost" href="/symphony">Ir directo a la sinfonía</a>
            </div>
          </div>
          <p className="lp-hero-note">
            El fondo son los rayos reales detectados desde la Estación Espacial, dibujados en píxeles. Mueve el mouse sobre ellos.
          </p>
        </section>

        {/* ── Lo que no se ve ── */}
        <section id="acto-2" className="lp-act lp-section lp-statement" aria-labelledby="t2">
          <h2 id="t2" className="lp-h2">Hoy, los datos de la Tierra solo existen para quien puede verlos.</h2>
          <p className="lp-lede">
            El Earth Information Center de la NASA publica visualizaciones de cómo cambia el planeta: tormentas,
            incendios, océanos. Todas son imágenes. Para una persona ciega o con baja visión, ese conocimiento no está.
          </p>
        </section>

        {/* ── Pieza: tormentas ── */}
        <section id="rayos" className="lp-act lp-piece" aria-labelledby="t-rayos">
          <div className="lp-piece-art">
            <PixelCanvas src="/video/lightning-2048.mp4" startAt={12} pixelSize={5} gain={1.7} />
          </div>
          <div className="lp-piece-text">
            <h2 id="t-rayos" className="lp-piece-title">Tormentas del planeta</h2>
            <p className="lp-piece-lede">
              Seis años de rayos vistos desde la Estación Espacial. Los grupos grandes tocan la melodía y el acorde
              sigue a las tormentas cuando cambian las estaciones.
            </p>
            <ul className="lp-checks">
              <li>Rayos de 2017 a 2023, sensor LIS de la NASA</li>
              <li>Cada región del mundo tiene su voz</li>
              <li>Las tormentas al norte suenan agudo; al sur, grave</li>
            </ul>
            <a className="lp-btn" href="/symphony?pista=rayos">Escuchar las tormentas</a>
          </div>
        </section>

        {/* ── Pieza: incendio ── */}
        <section id="incendio" className="lp-act lp-piece lp-piece-flip" aria-labelledby="t-incendio">
          <div className="lp-piece-art">
            <PixelCanvas src="/video/dixie-fire-landing.mp4" startAt={40} pixelSize={5} gain={1.15} />
          </div>
          <div className="lp-piece-text">
            <h2 id="t-incendio" className="lp-piece-title">Incendio Dixie, 2021</h2>
            <p className="lp-piece-lede">
              Cien días de un incendio en California, en cien segundos. Empieza en calma, llega al caos en dos olas
              y termina en silencio cuando el fuego se contiene.
            </p>
            <ul className="lp-checks">
              <li>Detectado cada 12 horas por el satélite Suomi-NPP</li>
              <li>El crepitar sigue al fuego activo</li>
              <li>Un tono grave crece con el área quemada</li>
            </ul>
            <a className="lp-btn" href="/symphony?pista=incendio">Escuchar el incendio</a>
          </div>
        </section>

        {/* ── Tu turno ── */}
        <section id="acto-4" className="lp-act lp-final" aria-labelledby="t4">
          <PixelCanvasBackground src="/video/dixie-fire-landing.mp4" startAt={8} overlayOpacity={0.35} />
          <div className="lp-final-inner">
            <h2 id="t4" className="lp-title lp-title-sm">
              <span>Ponte audífonos y escucha la Tierra.</span>
            </h2>
            <ul className="lp-checks lp-checks-light">
              <li>Pensado para personas ciegas o con baja visión</li>
              <li>Manos libres: la pieza avanza sola, tú solo escuchas</li>
              <li>La izquierda del mapa suena en tu oído izquierdo</li>
              <li>Funciona con teclado y con lector de pantalla</li>
            </ul>
            <a className="lp-pill lp-pill-big" href="/symphony">Entrar a The Earth Symphony ›</a>
          </div>
        </section>


      </main>
    </div>
  )
}
