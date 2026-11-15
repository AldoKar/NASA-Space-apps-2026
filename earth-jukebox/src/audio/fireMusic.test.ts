import { describe, expect, it } from 'vitest'
import {
  FIRE_CHORDS, FRONT_MAX_STEP, FRONT_RANGE, crackleCount, fireBass, fireChordFor, fireIntensity,
  fireLadder, firePhase, frontAllows, heartbeat, nextFrontIndex, screenToPan,
} from './fireMusic'

const PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10 }

describe('armonía del incendio', () => {
  it('la escalera de cada acorde solo tiene notas del acorde', () => {
    FIRE_CHORDS.forEach((c, i) => {
      const allowed = c.tones.map((t) => PC[t])
      for (const m of fireLadder(i, FRONT_RANGE[0], FRONT_RANGE[1])) expect(allowed).toContain(m % 12)
    })
  })
  it('más intensidad → acorde más tenso; al bajar vuelve a Re menor', () => {
    expect(fireChordFor(0, -1)).toBe(0)
    expect(fireChordFor(0.15, -1)).toBe(1)
    expect(fireChordFor(0.35, -1)).toBe(2)
    expect(fireChordFor(0.7, -1)).toBe(3)
    expect(fireChordFor(0.02, 3)).toBe(0)
  })
  it('histéresis: no cambia por una diferencia mínima en la frontera', () => {
    expect(fireChordFor(0.26, 1)).toBe(1)
  })
  it('el bajo es la nota base del acorde', () => {
    FIRE_CHORDS.forEach((c, i) => expect(fireBass(i) % 12).toBe(PC[c.tones[0]]))
  })
  it('la intensidad pesa más el fuego activo que el frente', () => {
    expect(fireIntensity(1, 0)).toBeGreaterThan(fireIntensity(0, 1))
  })
})

describe('melodía del frente', () => {
  it('más frente → más notas por tiempo', () => {
    const count = (f: number) => [0, 1, 2, 3].filter((s) => frontAllows(s, f)).length
    expect(count(0)).toBe(0)
    expect(count(0.1)).toBe(1)
    expect(count(0.3)).toBe(2)
    expect(count(0.6)).toBe(4)
  })
  it('camina por pasos (máx. 2) y nunca repite la misma nota', () => {
    let i = -1
    const seq: number[] = []
    for (const f of [0.05, 0.6, 0.6, 0.1, 0.9, 0.9, 0.9, 0.2]) {
      const n = nextFrontIndex(f, 12, i)
      if (i >= 0) {
        expect(Math.abs(n - i)).toBeLessThanOrEqual(FRONT_MAX_STEP)
        expect(n).not.toBe(i)
      }
      seq.push(n)
      i = n
    }
  })
  it('más frente → más agudo', () => {
    expect(nextFrontIndex(0.6, 12, -1)).toBeGreaterThan(nextFrontIndex(0.05, 12, -1))
  })
})

describe('fuego activo → percusión', () => {
  it('sin fuego no hay crepitar; con poco, al menos en el tiempo fuerte; con mucho, hasta 3', () => {
    expect(crackleCount(0, 0)).toBe(0)
    expect(crackleCount(0, 0.05)).toBe(1)
    expect(crackleCount(1, 0.05)).toBe(0)
    expect(crackleCount(1, 1)).toBe(3)
  })
  it('el latido solo en el tiempo fuerte y con fuego muy intenso', () => {
    expect(heartbeat(0, 0.6)).toBe(true)
    expect(heartbeat(1, 0.6)).toBe(false)
    expect(heartbeat(0, 0.3)).toBe(false)
  })
})

describe('lado y fase', () => {
  it('izquierda de la pantalla → audífono izquierdo, centro → centro', () => {
    expect(screenToPan(0)).toBe(-1)
    expect(screenToPan(0.5)).toBe(0)
    expect(screenToPan(1)).toBe(1)
    expect(screenToPan(0.3)).toBeLessThan(screenToPan(0.4))
  })
  it('fases en palabras', () => {
    expect(firePhase(0.02, 0, false)).toBe('calma')
    expect(firePhase(0.6, 0, false)).toBe('caos')
    expect(firePhase(0.2, 0.05, false)).toBe('creciendo')
    expect(firePhase(0.2, -0.05, false)).toBe('bajando')
    expect(firePhase(0.6, 0, true)).toBe('resumen')
  })
})
