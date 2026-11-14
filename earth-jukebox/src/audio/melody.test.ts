import { describe, expect, it } from 'vitest'
import { groupLevel, type Strike } from '../analysis/detector'
import { SEASON_CHORDS } from './harmony'
import { MAX_STEP, MelodyPlanner, REGION_RANGE, SlotQueue, regionLadder, regionOf } from './melody'

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function strike(p: Partial<Strike> = {}): Strike {
  const energy = p.energy ?? 1500
  return { x: 0.5, y: 0.5, lat: 0, lon: 20, energy, level: groupLevel(energy), neighbors: 0, isNew: false, land: true, ...p }
}
const melodyNotes = (r: ReturnType<MelodyPlanner['planSlot']>) => r.events.filter((e) => e.role === 'melodia').map((e) => e.midi)

describe('voces por región', () => {
  it('América / Europa-África / Asia-Oceanía', () => {
    expect(regionOf(-70)).toBe('oeste')
    expect(regionOf(20)).toBe('centro')
    expect(regionOf(110)).toBe('este')
  })
  it('cada región suena en su registro, siempre con notas del acorde', () => {
    for (const [lon, region] of [[-70, 'oeste'], [20, 'centro'], [110, 'este']] as const) {
      const p = new MelodyPlanner()
      for (let lat = -40; lat <= 40; lat += 10) {
        const notes = melodyNotes(p.planSlot(0, [strike({ lon, lat })], 2))
        for (const m of notes) {
          expect(m).toBeGreaterThanOrEqual(REGION_RANGE[region][0])
          expect(m).toBeLessThanOrEqual(REGION_RANGE[region][1])
          expect(SEASON_CHORDS[2].tones.map((t) => PC[t])).toContain(m % 12)
        }
      }
    }
  })
})

describe('movimiento por pasos', () => {
  it('nunca salta más de 2 notas del acorde entre una nota y la siguiente de la misma voz', () => {
    const p = new MelodyPlanner()
    const ladder = regionLadder(0, 'centro')
    let prev = -1
    for (const lat of [-45, 45, -45, 45, 0, 30, -30]) {
      const r = p.planSlot(0, [strike({ lat })], 0)
      const idx = ladder.indexOf(r.group!.midi)
      if (prev >= 0) expect(Math.abs(idx - prev)).toBeLessThanOrEqual(MAX_STEP)
      prev = idx
    }
  })
  it('si las tormentas se van al norte, la melodía sube', () => {
    const p = new MelodyPlanner()
    const a = p.planSlot(0, [strike({ lat: -30 })], 0).group!.midi
    p.planSlot(0, [strike({ lat: 40 })], 0)
    const c = p.planSlot(0, [strike({ lat: 40 })], 0).group!.midi
    expect(c).toBeGreaterThan(a)
  })
})

describe('conversación entre regiones (por frases)', () => {
  it('una región toca su frase y luego contesta otra que también tenga rayos grandes', () => {
    const p = new MelodyPlanner({ phraseLength: 3 })
    const both = [strike({ lon: -70, energy: 2400 }), strike({ lon: 110, energy: 1400 })]
    const seq = Array.from({ length: 6 }, () => p.planSlot(0, both, 0).group!.region)
    expect(seq).toEqual(['oeste', 'oeste', 'oeste', 'este', 'este', 'este'])
  })
  it('si la otra región es muy débil, no la fuerza', () => {
    const p = new MelodyPlanner({ phraseLength: 1 })
    p.planSlot(0, [strike({ lon: -70, energy: 2400 })], 0)
    const r = p.planSlot(0, [strike({ lon: -70, energy: 2400 }), strike({ lon: 110, energy: 1000 })], 0)
    expect(r.group!.region).toBe('oeste')
  })
})

describe('arpegios con dirección', () => {
  it('tormenta creciendo → sube; encogiéndose → baja', () => {
    const p = new MelodyPlanner()
    const up = p.planSlot(0, [strike({ neighbors: 4 })], 0)
    expect(up.group!.direction).toBe(1)
    const n1 = melodyNotes(up)
    expect(n1).toEqual([...n1].sort((a, b) => a - b))
    const down = p.planSlot(0, [strike({ neighbors: 2 })], 0)
    expect(down.group!.direction).toBe(-1)
    const n2 = melodyNotes(down)
    expect(n2).toEqual([...n2].sort((a, b) => b - a))
  })
})

describe('resolución en la calma', () => {
  it('cuando la actividad cae muy por debajo de su promedio, suena la nota base del acorde', () => {
    const p = new MelodyPlanner()
    const busy = Array.from({ length: 6 }, () => strike())
    for (let i = 0; i < 300; i++) p.planSlot(1, busy, 3) // actividad sostenida
    let resolved = false
    for (let i = 0; i < 40 && !resolved; i++) {
      const r = p.planSlot(1, [], 3)
      if (r.resolution) {
        resolved = true
        const note = r.events.find((e) => e.role === 'resolucion')!
        expect(note.midi % 12).toBe(PC[SEASON_CHORDS[3].tones[0]])
      }
    }
    expect(resolved).toBe(true)
  })
})

describe('cola entre tiempos (arreglo del silencio al inicio)', () => {
  it('un grupo grande que llega entre dos tiempos fuertes espera y suena en el siguiente', () => {
    const q = new SlotQueue()
    const p = new MelodyPlanner()
    q.add(strike({ energy: 1500 })) // llega en la semicorchea 1
    let r = p.planSlot(1, q.take(1).candidates, 0, q.take(1).arrivals)
    expect(r.group).toBeNull()
    q.endSlot(1, false)
    for (const sub of [2, 3]) { q.take(sub); q.endSlot(sub, false) }
    const { candidates, arrivals } = q.take(0) // siguiente tiempo fuerte
    r = p.planSlot(0, candidates, 0, arrivals)
    expect(r.group).not.toBeNull()
  })
  it('si no hay grupos grandes, en el tiempo fuerte toca el grupo más grande del momento', () => {
    const q = new SlotQueue()
    q.add(strike({ energy: 150 }))
    q.add(strike({ energy: 700 }))
    const { candidates } = q.take(0)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].energy).toBe(700)
  })
  it('un grupo grande que no suena se descarta tras una negra', () => {
    const q = new SlotQueue()
    q.add(strike({ energy: 1500 }))
    for (let i = 0; i < 4; i++) { q.take(1); q.endSlot(1, false) }
    expect(q.take(0).candidates).toHaveLength(0)
  })
  it('el grupo de respaldo no se arrastra más allá de un tiempo fuerte', () => {
    const q = new SlotQueue()
    q.add(strike({ energy: 300 }))
    q.take(0); q.endSlot(0, false)
    expect(q.take(0).candidates).toHaveLength(0)
  })
})
