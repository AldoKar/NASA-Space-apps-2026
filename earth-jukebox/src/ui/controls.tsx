import type { ReactNode } from 'react'

/** Interruptor estilo iOS (role="switch"). */
export function Switch(props: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  shortcut?: string
}) {
  const id = `sw-${props.label.replace(/\s+/g, '-').toLowerCase()}`
  // La explicación no se muestra (la pantalla queda limpia), pero el lector de pantalla la lee.
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-label" id={id}>{props.label}</span>
        {props.description && <span className="sr-only" id={`${id}-desc`}>{props.description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-labelledby={id}
        aria-describedby={props.description ? `${id}-desc` : undefined}
        aria-keyshortcuts={props.shortcut}
        className="switch"
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  )
}

/** Control segmentado (grupo de opciones excluyentes). */
export function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  const idx = props.options.findIndex((o) => o.value === props.value)
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={props.label}
      style={{ ['--seg-count' as string]: props.options.length, ['--seg-index' as string]: idx }}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Sección agrupada. La explicación (footer) queda plegada detrás de una flecha. */
export function Section(props: { title: string; footer?: ReactNode; moreLabel?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`group ${props.className ?? ''}`}>
      <h3 className="group-title">{props.title}</h3>
      <div className="group-body">{props.children}</div>
      {props.footer && <More label={props.moreLabel ?? 'Cómo funciona'}>{props.footer}</More>}
    </section>
  )
}

/** Texto plegable: una flecha que despliega la explicación (details/summary nativo, accesible por teclado). */
export function More(props: { label: string; id?: string; children: ReactNode }) {
  return (
    <details className="more">
      <summary>
        <span className="more-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        {props.label}
      </summary>
      <p className="more-body" id={props.id}>{props.children}</p>
    </details>
  )
}

/** Barra de nivel con semántica de medidor para lectores de pantalla. */
export function Gauge(props: { value: number; label: string; valueText: string }) {
  return (
    <div
      className="gauge"
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(props.value.toFixed(2))}
      aria-valuetext={props.valueText}
    >
      <span className="gauge-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, props.value))})` }} />
    </div>
  )
}

export const Icon = {
  play: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" /></svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" /></svg>
  ),
  restart: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.05-4.95M5 4v4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  speaker: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="currentColor" /><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  describe: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
  wave: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
}
