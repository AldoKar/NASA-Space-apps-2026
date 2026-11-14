import { useEffect, useRef, useState } from 'react'

/**
 * Resorte críticamente amortiguado (damping 1.0), como los que usa Apple por defecto:
 * siempre parte del valor actual en pantalla, así que se puede redirigir en cualquier momento.
 * `response` ≈ segundos para llegar al objetivo. Con reduced motion salta directo.
 */
export function useSpring(target: number, response = 0.4, reduced = false): number {
  const [value, setValue] = useState(target)
  const state = useRef({ x: target, v: 0, target })
  state.current.target = target

  useEffect(() => {
    if (reduced) {
      state.current.x = target
      state.current.v = 0
      setValue(target)
      return
    }
    let raf = 0
    let last = performance.now()
    const omega = (2 * Math.PI) / response
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      const s = state.current
      // x'' = -ω²(x - target) - 2ω x'  (amortiguamiento crítico)
      const a = -omega * omega * (s.x - s.target) - 2 * omega * s.v
      s.v += a * dt
      s.x += s.v * dt
      if (Math.abs(s.x - s.target) < 1e-4 && Math.abs(s.v) < 1e-3) {
        s.x = s.target
        s.v = 0
        setValue(s.x)
        return
      }
      setValue(s.x)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, response, reduced])

  return value
}
