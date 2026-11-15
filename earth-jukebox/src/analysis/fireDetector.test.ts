import { describe, expect, it } from 'vitest'
import { FIRE_H, FIRE_W, FireDetector, isBurnedGray, isFireRed, isFrontYellow } from './fireDetector'

const W = FIRE_W, H = FIRE_H
function frame(paint: (x: number, y: number) => [number, number, number] | null) {
  const a = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = paint(x, y) ?? [60, 110, 50] // bosque
    const i = (y * W + x) * 4
    a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255
  }
  return a
}

describe('colores medidos en el video', () => {
  it('rojo del fuego, amarillo del frente y gris quemado', () => {
    expect(isFireRed(236, 24, 21)).toBe(true)
    expect(isFrontYellow(248, 234, 110)).toBe(true)
    expect(isBurnedGray(118, 118, 120)).toBe(true)
  })
  it('el desierto y el bosque no se confunden con fuego ni frente', () => {
    expect(isFrontYellow(212, 187, 128)).toBe(false) // arena medida en el video
    expect(isFireRed(150, 110, 70)).toBe(false) // tierra café
    expect(isBurnedGray(60, 110, 50)).toBe(false) // bosque
  })
})

describe('FireDetector', () => {
  it('mide fuego activo y lado del frente', () => {
    const d = new FireDetector()
    const f = d.analyze(frame((x, y) => (x < 100 && y > 200 && y < 300 ? [236, 24, 21] : x > 600 && x < 640 && y < 300 ? [248, 234, 110] : null)), 0)
    expect(f.active).toBeGreaterThan(0.5)
    expect(f.front).toBeGreaterThan(0.5)
    expect(f.fireX).toBeLessThan(0.2)
    expect(f.frontX).toBeGreaterThan(0.7)
  })
  it('ignora la gráfica de la derecha y la etiqueta de la fecha', () => {
    const d = new FireDetector()
    const f = d.analyze(frame((x, y) => (x > 800 || (x < 150 && y < 45) ? [236, 24, 21] : null)), 0)
    expect(f.active).toBe(0)
  })
  it('el área quemada nunca baja (aunque la cámara se aleje)', () => {
    const d = new FireDetector()
    const big = d.analyze(frame((x, y) => (x < 500 && y < 300 ? [118, 118, 120] : null)), 0)
    const small = d.analyze(frame((x, y) => (x < 250 && y < 150 ? [118, 118, 120] : null)), 1 / 30)
    expect(small.burned).toBe(big.burned)
  })
  it('detecta el resumen final (gráfica en rojo) y no lo cuenta como fuego', () => {
    const d = new FireDetector()
    const f = d.analyze(frame((x, y) => (x > 810 && x < 940 && y > 100 && y < 450 ? [230, 60, 20] : x < 300 && y > 200 && y < 300 ? [236, 24, 21] : null)), 97)
    expect(f.recap).toBe(true)
    expect(f.active).toBe(0)
  })
})
