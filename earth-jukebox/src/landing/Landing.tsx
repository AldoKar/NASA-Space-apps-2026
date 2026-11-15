import { PixelCanvas } from './PixelCanvas'
import { PixelCanvasBackground } from './PixelCanvasBackground'
import { useVoiceHandler } from '../voice/VoiceProvider'
import type { Command } from '../voice/commands'
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

const SECTIONS = ['acto-1', 'acto-2', 'rayos', 'incendio', 'acto-4']

/** Sección que ocupa el centro de la pantalla. */
function currentSection(): number {
  const mid = window.innerHeight / 2
  let best = 0
  SECTIONS.forEach((id, i) => {
    const r = document.getElementById(id)?.getBoundingClientRect()
    if (r && r.top <= mid) best = i
  })
  return best
}

/** Texto de una sección para leerlo en voz alta: título, párrafo y lista. */
function sectionText(id: string): string {
  const el = document.getElementById(id)
  if (!el) return ''
  const clean = (t?: string | null) => (t ?? '').replace(/\s+/g, ' ').trim()
  const title = clean(el.querySelector('h1, h2')?.textContent)
  const body = clean(el.querySelector('.lp-sub, .lp-lede, .lp-piece-lede')?.textContent)
  const items = [...el.querySelectorAll('.lp-checks li')].map((li) => clean(li.textContent)).join('. ')
  const end = (t: string) => (t && !/[.?!]$/.test(t) ? `${t}.` : t)
  return [end(title), end(body), end(items)].filter(Boolean).join(' ')
}

const NEXT_HINT: Record<string, string> = {
  'acto-1': 'Say next to continue.',
  'acto-2': 'Say next to continue.',
  rayos: 'Say: take me to the storms to hear them, or next.',
  incendio: 'Say: take me to the fire to hear it, or next.',
  'acto-4': 'Say: take me to the storms, or take me to the fire.',
}

/** Comandos de voz de la página de inicio: recorrer las secciones y leerlas en voz alta. */
function onVoice(cmd: Command): string | null {
  if (cmd.type === 'tour') {
    const i = currentSection()
    const next = Math.max(0, Math.min(SECTIONS.length - 1, i + cmd.dir))
    if (next === i) return cmd.dir > 0 ? `You reached the end. ${NEXT_HINT['acto-4']}` : 'You are already at the beginning.'
    goTo(SECTIONS[next])
    return `${sectionText(SECTIONS[next])} ${NEXT_HINT[SECTIONS[next]]}`
  }
  if (cmd.type === 'describe') {
    const id = SECTIONS[currentSection()]
    return `${sectionText(id)} ${NEXT_HINT[id]}`
  }
  return null
}

export default function Landing() {
  useVoiceHandler(onVoice)
  return (
    <div className="lp">
      <a className="lp-skip" href="/symphony">Skip to The Earth Symphony</a>

      <main className="lp-col">
        {/* ── La pregunta ── */}
        <section id="acto-1" className="lp-act lp-hero" aria-labelledby="t1">
          <PixelCanvas src="/video/lightning-landing.mp4" pixelSize={6} gain={1.6} />
          <div className="lp-hero-inner">
            <h1 id="t1" className="lp-title">
              <span>Have you ever imagined what nature sounds like?</span>
            </h1>
            <p className="lp-sub">
              You don’t need to see the screen. Just listen.
            </p>
            <div className="lp-ctas">
              <button type="button" className="lp-pill" onClick={() => goTo('acto-2')}>
                Start the tour ›
              </button>
              <a className="lp-ghost" href="/symphony">Go straight to the symphony</a>
            </div>
          </div>
          <p className="lp-hero-note">
            The background is real lightning detected from the Space Station, drawn in pixels.
          </p>
        </section>

        {/* ── Lo que no se ve ── */}
        <section id="acto-2" className="lp-act lp-section lp-statement" aria-labelledby="t2">
          <h2 id="t2" className="lp-h2">Today, Earth data only exists for those who can see it.</h2>
          <p className="lp-lede">
            NASA’s Earth Information Center publishes visualizations of how our planet changes: storms, wildfires,
            oceans. They are all images. For a blind or low-vision person, that knowledge simply isn’t there.
          </p>
        </section>

        {/* ── Pieza: tormentas ── */}
        <section id="rayos" className="lp-act lp-piece" aria-labelledby="t-rayos">
          <div className="lp-piece-art">
            <PixelCanvas src="/video/lightning-landing.mp4" startAt={10} pixelSize={5} gain={1.7} />
          </div>
          <div className="lp-piece-text">
            <h2 id="t-rayos" className="lp-piece-title">Storms of the planet</h2>
            <p className="lp-piece-lede">
              Six years of lightning seen from the Space Station. Large groups play the melody, and the chord
              follows the storms as the seasons change.
            </p>
            <ul className="lp-checks">
              <li>Lightning from 2017 to 2023, NASA’s LIS sensor</li>
              <li>Each region of the world has its own voice</li>
              <li>Storms in the north sound high; in the south, low</li>
            </ul>
            <a className="lp-btn" href="/symphony?pista=rayos">Listen to the storms</a>
          </div>
        </section>

        {/* ── Pieza: incendio ── */}
        <section id="incendio" className="lp-act lp-piece lp-piece-flip" aria-labelledby="t-incendio">
          <div className="lp-piece-art">
            <PixelCanvas src="/video/dixie-fire-landing.mp4" startAt={6} pixelSize={5} gain={1.15} />
          </div>
          <div className="lp-piece-text">
            <h2 id="t-incendio" className="lp-piece-title">Dixie Fire, 2021</h2>
            <p className="lp-piece-lede">
              One hundred days of a California wildfire in one hundred seconds. It starts calm, reaches chaos in two
              waves and ends in silence when the fire is contained.
            </p>
            <ul className="lp-checks">
              <li>Detected every 12 hours by the Suomi-NPP satellite</li>
              <li>The crackling follows the active fire</li>
              <li>A low drone grows with the burned area</li>
            </ul>
            <a className="lp-btn" href="/symphony?pista=incendio">Listen to the fire</a>
          </div>
        </section>

        {/* ── Tu turno ── */}
        <section id="acto-4" className="lp-act lp-final" aria-labelledby="t4">
          <PixelCanvasBackground src="/video/dixie-fire-landing.mp4" overlayOpacity={0.35} />
          <div className="lp-final-inner">
            <h2 id="t4" className="lp-title lp-title-sm">
              <span>Put on your headphones and listen to the Earth.</span>
            </h2>
            <ul className="lp-checks lp-checks-light">
              <li>Designed for blind and low-vision people</li>
              <li>Hands-free: control it with your voice</li>
              <li>The left side of the map sounds in your left ear</li>
              <li>Works with keyboard and screen readers</li>
            </ul>
            <a className="lp-pill lp-pill-big" href="/symphony">Enter The Earth Symphony ›</a>
          </div>
        </section>


      </main>
    </div>
  )
}
