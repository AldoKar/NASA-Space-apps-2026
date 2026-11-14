import { describe, expect, it } from 'vitest'
import type { Strike } from '../analysis/detector'
import { groupLevel } from '../analysis/detector'
import {
  SEASON_CHORDS, chordIndexFor, chordLadder, dynamics, isMelodic, latToLadderIndex,
  midiToNote, pickForSlot, slotAllows, textureTicks, voicing,
} from './harmony'

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function strike(p: Partial<Strike> = {}): Strike {
  const energy = p.energy ?? 1500
  return { x: 0.5, y: 0.5, lat: 0, lon: 0, energy, level: groupLevel(energy), neighbors: 0, isNew: false, land: true, ...p }
}

describe('armonía: las notas salen del acorde de la estación', () => {
  it('cada escalera contiene SOLO notas del acorde', () => {
    SEASON_CHORDS.forEach((c, i) => {
      const allowed = c.tones.map((t) => PC[t])
      for (const m of chordLadder(i)) expect(allowed).toContain(m % 12)
    })
  })
  it('todas las combinaciones latitud × tamaño de tormenta dan notas del acorde', () => {
    SEASON_CHORDS.forEach((c, i) => {
      const ladder = chordLadder(i)
      const allowed = c.tones.map((t) => PC[t])
      for (let lat = -60; lat <= 60; lat += 5)
        for (const nb of [0, 1, 2, 3, 8])
          for (const li of voicing(latToLadderIndex(lat, ladder.length), nb))
            expect(allowed).toContain(ladder[li] % 12)
    })
  })
  it('todos los acordes son diatónicos (teclas blancas): suenan bien al cambiar de uno a otro', () => {
    for (const c of SEASON_CHORDS) for (const t of c.tones) expect(t).toMatch(/^[A-G]$/)
  })
  it('norte suena más agudo que sur', () => {
    const L = chordLadder(0).length
    expect(latToLadderIndex(30, L)).toBeGreaterThan(latToLadderIndex(-30, L))
  })
  it('no repite la misma nota dos veces seguidas', () => {
    const L = chordLadder(2).length
    const a = latToLadderIndex(10, L)
    expect(latToLadderIndex(10, L, a)).not.toBe(a)
  })
  it('midiToNote', () => {
    expect(midiToNote(60)).toBe('C4')
    expect(midiToNote(69)).toBe('A4')
  })
  it('histéresis del acorde', () => {
    expect(chordIndexFor(20, -1)).toBe(3)
    expect(chordIndexFor(17, 2)).toBe(2) // dentro del margen de 2°: no cambia
  })
})

describe('tamaño de tormenta → número de notas', () => {
  it('aislado: 1, con 1–2 vecinas: 2, con 3+: arpegio de 3', () => {
    expect(voicing(10, 0)).toHaveLength(1)
    expect(voicing(10, 2)).toHaveLength(2)
    expect(voicing(10, 5)).toHaveLength(3)
  })
  it('el arpegio sube y termina en la nota de la latitud', () => {
    const v = voicing(10, 4)
    expect(v).toEqual([...v].sort((a, b) => a - b))
    expect(v[v.length - 1]).toBe(10)
  })
})

describe('qué suena en cada tiempo del pulso', () => {
  it('solo los grupos grandes tocan melodía', () => {
    expect(isMelodic(strike({ energy: 300 }))).toBe(false)
    expect(isMelodic(strike({ energy: 800 }))).toBe(false)
    expect(isMelodic(strike({ energy: 1200 }))).toBe(true)
  })
  it('elige por prioridad: tormentas nuevas y océano primero', () => {
    const c = [
      strike({ energy: 2400, x: 0.1 }),
      strike({ energy: 1100, x: 0.4, isNew: true }),
      strike({ energy: 1100, x: 0.7, land: false }),
    ]
    expect(pickForSlot(c)).toHaveLength(1)
    const p = pickForSlot(c, 2)
    expect(p).toHaveLength(2)
    expect(p[0].isNew).toBe(true)
    expect(p[1].land).toBe(false)
  })
  it('más grande = más fuerte y más largo', () => {
    const a = dynamics(strike({ energy: 1000 }))
    const b = dynamics(strike({ energy: 2400 }))
    expect(b.velocity).toBeGreaterThan(a.velocity)
    expect(b.duration).toBeGreaterThan(a.duration)
  })
  it('textura: 0 chispazos en calma, hasta 2 en momentos intensos (medido: 23–70 por tiempo)', () => {
    expect(textureTicks(10)).toBe(0)
    expect(textureTicks(23)).toBe(0)
    expect(textureTicks(45)).toBe(1)
    expect(textureTicks(70)).toBe(2)
    expect(textureTicks(200)).toBe(2)
  })
})

describe('ritmo: la intensidad decide la subdivisión', () => {
  it('sin grupos grandes: silencio', () => {
    for (const sub of [0, 1, 2, 3]) expect(slotAllows(sub, 0)).toBe(false)
  })
  it('calma: solo tiempos fuertes · media: corcheas · intensa: semicorcheas', () => {
    expect([0, 1, 2, 3].map((s) => slotAllows(s, 2))).toEqual([true, false, false, false])
    expect([0, 1, 2, 3].map((s) => slotAllows(s, 5))).toEqual([true, false, true, false])
    expect([0, 1, 2, 3].map((s) => slotAllows(s, 9))).toEqual([true, true, true, true])
  })
})
