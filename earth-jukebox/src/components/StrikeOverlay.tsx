import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Strike } from '../analysis/detector'
import type { PlayedStrike } from '../audio/stormEngine'

export interface StrikeOverlayHandle {
  addStrikes: (s: PlayedStrike[]) => void
  addThunder: (s: Strike) => void
}

interface Ring {
  x: number
  y: number
  born: number
  big: boolean
  /** 1 = grande, 1.6 = muy grande */
  scale: number
  ocean: boolean
}

/**
 * Capa visual encima del video: dibuja un anillo en cada rayo que SONÓ,
 * para que se vea la relación entre lo que se escucha y el lugar del mapa.
 */
export const StrikeOverlay = forwardRef<StrikeOverlayHandle, { reducedMotion: boolean }>(
  function StrikeOverlay({ reducedMotion }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const rings = useRef<Ring[]>([])

    useImperativeHandle(ref, () => ({
      addStrikes(s) {
        const now = performance.now()
        for (const k of s)
          rings.current.push({ x: k.x, y: k.y, born: now, big: false, scale: k.level === 'muy grande' ? 1.6 : 1, ocean: !k.land })
        if (rings.current.length > 200) rings.current.splice(0, rings.current.length - 200)
      },
      addThunder(s) {
        rings.current.push({ x: s.x, y: s.y, born: performance.now(), big: true, scale: 1, ocean: false })
      },
    }))

    useEffect(() => {
      let raf = 0
      const draw = () => {
        const c = canvasRef.current
        if (c) {
          const dpr = window.devicePixelRatio || 1
          const w = c.clientWidth
          const h = c.clientHeight
          if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
            c.width = Math.round(w * dpr)
            c.height = Math.round(h * dpr)
          }
          const ctx = c.getContext('2d')!
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, w, h)
          const now = performance.now()
          const life = reducedMotion ? 500 : 900
          rings.current = rings.current.filter((r) => now - r.born < (r.big ? life * 2 : life))
          for (const r of rings.current) {
            const t = (now - r.born) / (r.big ? life * 2 : life)
            const alpha = 1 - t
            const radius = (reducedMotion ? (r.big ? 10 : 5) : r.big ? 12 + t * 60 : 3 + t * 16) * r.scale
            ctx.beginPath()
            ctx.arc(r.x * w, r.y * h, radius, 0, Math.PI * 2)
            ctx.strokeStyle = r.big
              ? `rgba(160, 200, 255, ${alpha * 0.9})`
              : r.ocean
                ? `rgba(130, 220, 255, ${alpha})`
                : `rgba(255, 245, 190, ${alpha})`
            ctx.lineWidth = r.big ? 2.5 : 1.5
            ctx.stroke()
          }
        }
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
      return () => cancelAnimationFrame(raf)
    }, [reducedMotion])

    return <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
  },
)
