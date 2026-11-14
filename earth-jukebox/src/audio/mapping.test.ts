import { describe, expect, it } from 'vitest'
import { balanceOf, lonToPan } from './mapping'

describe('lonToPan: el mapa partido por una línea vertical', () => {
  it('bordes y centro', () => {
    expect(lonToPan(-180)).toBe(-1)
    expect(lonToPan(0)).toBe(0)
    expect(lonToPan(180)).toBe(1)
  })
  it('más a la izquierda en el mapa = más a la izquierda en el oído', () => {
    const lons = [-180, -120, -60, -10, 0, 10, 60, 120, 180]
    const pans = lons.map(lonToPan)
    for (let i = 1; i < pans.length; i++) expect(pans[i]).toBeGreaterThan(pans[i - 1])
  })
  it('América se oye claramente a la izquierda y Asia a la derecha', () => {
    expect(lonToPan(-60)).toBeLessThan(-0.45) // Sudamérica
    expect(lonToPan(110)).toBeGreaterThan(0.7) // Sudeste asiático
  })
  it('balance ponderado por energía', () => {
    expect(balanceOf([])).toBeNull()
    expect(balanceOf([{ lon: -90, energy: 1 }, { lon: 90, energy: 1 }])).toBeCloseTo(0)
    expect(balanceOf([{ lon: -90, energy: 3 }, { lon: 90, energy: 1 }])!).toBeLessThan(0)
  })
})
