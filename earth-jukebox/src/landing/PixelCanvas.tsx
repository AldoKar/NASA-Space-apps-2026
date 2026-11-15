import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { buildLut, mountPixelMedia } from './pixelRenderer'

/**
 * Fondo de píxeles en azul NASA (rampa negro → azul → hielo; lo "caliente" del dato en blanco).
 * Adaptado de PixelCanvasBackground de CareMap y dibujado con el motor optimizado (pixelRenderer.ts).
 */
export interface PixelCanvasProps {
  src: string
  pixelSize?: number
  /** Ganancia de brillo para la rampa azul (1 = tal cual). */
  gain?: number
  interactive?: boolean
  /** Para videos: segundo en el que empieza el bucle. */
  startAt?: number
  className?: string
  style?: CSSProperties
}

const RAMP: [number, number, number][] = [
  [0, 0, 0],
  [8, 30, 84],
  [11, 61, 145],
  [61, 134, 255],
  [201, 220, 255],
]
function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (RAMP.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

/** Tabla de color "NASA" para una ganancia dada. */
function nasaLut(gain: number) {
  return buildLut((r, g, b) => {
    const hot = (r > 150 && r - b > 90 && g > 120) || (r > 170 && g < 90 && b < 90) // rayos amarillos, fuego rojo
    if (hot) return [240, 246, 255]
    const lum = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * gain
    if (lum < 0.04) return null // fondo: negro puro
    return ramp(Math.pow(lum, 0.85))
  })
}

export function PixelCanvas({ src, pixelSize = 6, gain = 1, interactive = true, startAt = 0, className, style }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lut = useMemo(() => nasaLut(gain), [gain])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return mountPixelMedia(canvas, src, { pixelSize, shape: 'random', lut, interactive, startAt })
  }, [src, pixelSize, lut, interactive, startAt])

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', ...style }} aria-hidden="true">
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
