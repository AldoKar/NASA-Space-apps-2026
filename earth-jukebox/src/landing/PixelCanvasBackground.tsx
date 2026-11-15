import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { fullLut, greyLut, mountPixelMedia, paletteLut, type ShapeMode } from './pixelRenderer'

/**
 * Fondo de video en píxeles — el componente que nos pasaron, con la misma API y el mismo aspecto,
 * pero dibujado con el motor optimizado de pixelRenderer.ts (antes: ~320,000 figuras por cuadro;
 * ahora: unas pocas operaciones por cuadro).
 *
 * Cambios respecto al original:
 *  - Se posiciona dentro de su contenedor (absolute) en vez de cubrir toda la ventana (fixed),
 *    para poder usarlo como fondo de una sola sección.
 *  - colorMode "three" (el valor por defecto del original) no estaba implementado, así que el original
 *    mostraba los colores reales del video; aquí se conserva ese mismo resultado ("three" = colores reales).
 *  - overlayBlur por defecto 0: el desenfoque sobre un video animado es muy costoso.
 */
export interface PixelCanvasBackgroundProps {
  src?: string
  pixelSize?: number
  shapeMode?: ShapeMode
  colorMode?: 'palette' | 'full' | 'greyscale' | 'three'
  palette?: string[]
  contrast?: number
  lightness?: number
  interactive?: boolean
  overlayOpacity?: number
  overlayBlur?: number
  startAt?: number
  className?: string
  style?: CSSProperties
}

const DEFAULT_PALETTE = ['#FF0000', '#000000', '#00BFFF', '#FFD700']

export function PixelCanvasBackground({
  src = '/video/dixie-fire-landing.mp4',
  pixelSize = 2,
  shapeMode = 'circles',
  colorMode = 'three',
  palette = DEFAULT_PALETTE,
  contrast = 100,
  lightness = 100,
  interactive = true,
  overlayOpacity = 0.45,
  overlayBlur = 0,
  startAt = 0,
  className = '',
  style = {},
}: PixelCanvasBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteKey = palette.join(',')
  const lut = useMemo(
    () =>
      colorMode === 'palette' ? paletteLut(paletteKey.split(',')) : colorMode === 'greyscale' ? greyLut() : fullLut(),
    [colorMode, paletteKey],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return mountPixelMedia(canvas, src, { pixelSize, shape: shapeMode, lut, contrast, lightness, interactive, startAt }, (ms) => {
      ;(window as unknown as { __pxMs?: number }).__pxMs = ms
    })
  }, [src, pixelSize, shapeMode, lut, contrast, lightness, interactive, startAt])

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden', ...style }} aria-hidden="true">
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {overlayOpacity > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})`,
            backdropFilter: overlayBlur > 0 ? `blur(${overlayBlur}px)` : undefined,
            WebkitBackdropFilter: overlayBlur > 0 ? `blur(${overlayBlur}px)` : undefined,
          }}
        />
      )}
    </div>
  )
}

export default PixelCanvasBackground
