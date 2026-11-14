import { describe, expect, it } from 'vitest'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector, formatLat, yellowness } from './detector'

const GRAY = [72, 72, 72]
const BOLT = [165, 158, 26] // color medido de los rayos en el video de la NASA

function frame(dots: { lat: number; lon: number }[] = [], size = 3) {
  const a = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  for (let i = 0; i < a.length; i += 4) {
    a[i] = GRAY[0]; a[i + 1] = GRAY[1]; a[i + 2] = GRAY[2]; a[i + 3] = 255
  }
  for (const d of dots) {
    const cx = Math.round(((d.lon + 180) / 360) * ANALYSIS_W)
    const cy = Math.round(((90 - d.lat) / 180) * ANALYSIS_H)
    for (let y = cy; y < cy + size; y++)
      for (let x = cx; x < cx + size; x++) {
        const i = (y * ANALYSIS_W + x) * 4
        a[i] = BOLT[0]; a[i + 1] = BOLT[1]; a[i + 2] = BOLT[2]
      }
  }
  return a
}

describe('yellowness', () => {
  it('ignora el gris del mapa y las líneas', () => {
    expect(yellowness(72, 72, 72)).toBe(0)
    expect(yellowness(20, 20, 20)).toBe(0)
  })
  it('detecta el amarillo de los rayos', () => {
    expect(yellowness(165, 158, 26)).toBeGreaterThan(100)
  })
})

describe('LightningDetector', () => {
  it('el primer cuadro no dispara rayos (no hay con qué comparar)', () => {
    const d = new LightningDetector()
    const f = d.analyze(frame([{ lat: 10, lon: 20 }]), 0)
    expect(f.isReset).toBe(true)
    expect(f.strikes).toHaveLength(0)
    expect(f.activity).toBeGreaterThan(0)
  })

  it('un punto que aparece es un rayo nuevo, con su posición', () => {
    const d = new LightningDetector()
    d.analyze(frame([]), 0)
    const f = d.analyze(frame([{ lat: 30, lon: -90 }], 4), 1 / 30)
    expect(f.strikes).toHaveLength(1)
    expect(f.strikes[0].lat).toBeGreaterThan(24)
    expect(f.strikes[0].lat).toBeLessThan(36)
    expect(f.strikes[0].lon).toBeGreaterThan(-96)
    expect(f.strikes[0].lon).toBeLessThan(-84)
    expect(f.newRate).toBeGreaterThan(0)
  })

  it('un punto que se queda (ventana de 10 días) NO vuelve a sonar', () => {
    const d = new LightningDetector()
    const dots = [{ lat: -10, lon: 40 }]
    d.analyze(frame([]), 0)
    expect(d.analyze(frame(dots, 4), 0.033).strikes).toHaveLength(1)
    expect(d.analyze(frame(dots, 4), 0.066).strikes).toHaveLength(0)
    expect(d.analyze(frame(dots, 4), 0.1).strikes).toHaveLength(0)
  })

  it('la latitud promedio sigue a las tormentas (estaciones)', () => {
    const d = new LightningDetector()
    const north = d.analyze(frame([{ lat: 30, lon: 0 }, { lat: 25, lon: 50 }]), 0)
    expect(north.meanLat).toBeGreaterThan(20)
    expect(north.northShare).toBeGreaterThan(0.9)
    const south = d.analyze(frame([{ lat: -15, lon: 0 }, { lat: -20, lon: 50 }]), 0.033)
    expect(south.meanLat).toBeLessThan(-10)
    expect(south.northShare).toBeLessThan(0.1)
  })

  it('un salto en el video no genera una avalancha falsa', () => {
    const d = new LightningDetector()
    d.analyze(frame([]), 10)
    const f = d.analyze(frame([{ lat: 0, lon: 0 }, { lat: 20, lon: 100 }]), 40)
    expect(f.isReset).toBe(true)
    expect(f.strikes).toHaveLength(0)
  })
})

describe('formatLat', () => {
  it('formatea norte y sur', () => {
    expect(formatLat(23.4)).toBe('23° N')
    expect(formatLat(-12.6)).toBe('13° S')
  })
})
