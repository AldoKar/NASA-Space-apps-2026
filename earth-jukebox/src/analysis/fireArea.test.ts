import { describe, expect, it } from 'vitest'
import { AREA_BY_DAY, AREA_FINAL, areaOnDay, fireAreaAt, growthOnDay } from './fireArea'

describe('área quemada desde la gráfica', () => {
  it('nunca baja', () => {
    for (let i = 1; i < AREA_BY_DAY.length; i++) expect(AREA_BY_DAY[i]).toBeGreaterThanOrEqual(AREA_BY_DAY[i - 1])
  })
  it('empieza en 0 y termina en el área final', () => {
    expect(areaOnDay(0)).toBe(0)
    expect(areaOnDay(100)).toBe(AREA_FINAL)
    expect(fireAreaAt(0).fraction).toBe(0)
    expect(fireAreaAt(95).fraction).toBe(1)
  })
  it('el mayor crecimiento es a inicios de agosto (carrera de Greenville)', () => {
    let best = 0, bestDay = 0
    for (let d = 0; d <= 100; d += 0.5) {
      const g = growthOnDay(d)
      if (g > best) { best = g; bestDay = d }
    }
    expect(bestDay).toBeGreaterThanOrEqual(20)
    expect(bestDay).toBeLessThanOrEqual(25)
  })
  it('crecimiento 0..1 y casi 0 al final', () => {
    for (let t = 0; t < 102; t += 0.5) {
      const a = fireAreaAt(t)
      expect(a.growth).toBeGreaterThanOrEqual(0)
      expect(a.growth).toBeLessThanOrEqual(1)
    }
    expect(fireAreaAt(90).growth).toBeLessThan(0.02)
  })
})
