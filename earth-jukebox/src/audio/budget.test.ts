import { describe, expect, it } from 'vitest'
import { groupLevel, type Strike } from '../analysis/detector'
import { HARD_CAP, NoteBudget, SOFT_CAP, capFor, densityGain, pickVoice, rankOf, safeStart } from './budget'
import { SLOT } from './harmony'
import { MelodyPlanner } from './melody'

function strike(p: Partial<Strike> = {}): Strike {
  const energy = p.energy ?? 1500
  return { x: 0.5, y: 0.5, lat: 0, lon: 20, energy, level: groupLevel(energy), neighbors: 0, isNew: false, land: true, ...p }
}

describe('presupuesto de notas', () => {
  it('prioridades: resolución > líder > acompañante > acento > destello', () => {
    const r = ['resolucion', 'lider', 'acompanante', 'acento', 'destello'].map((x) => rankOf(x as never))
    expect(r).toEqual([...r].sort((a, b) => b - a))
  })
  it('cuanto menos importante, antes deja de entrar', () => {
    const caps = ['resolucion', 'lider', 'acompanante', 'acento', 'destello'].map((x) => capFor(rankOf(x as never)))
    expect(caps).toEqual([...caps].sort((a, b) => b - a))
  })
  it('los destellos se detienen en el tope suave', () => {
    const b = new NoteBudget()
    let ok = 0
    for (let i = 0; i < 30; i++) if (b.admit(i * 0.02, rankOf('destello'))) ok++
    expect(ok).toBe(SOFT_CAP)
  })
  it('las esenciales pueden llegar al tope duro, pero no pasarlo', () => {
    const b = new NoteBudget()
    let ok = 0
    for (let i = 0; i < 40; i++) if (b.admit(i * 0.02, rankOf('lider'))) ok++
    expect(ok).toBe(HARD_CAP)
  })
  it('la ventana es de 1 s: después vuelve a haber lugar', () => {
    const b = new NoteBudget()
    for (let i = 0; i < SOFT_CAP; i++) b.admit(0.01 * i, 10)
    expect(b.admit(0.5, 10)).toBe(false)
    expect(b.admit(0.5, rankOf('lider'))).toBe(true) // la melodía sí tiene lugar
    expect(b.admit(1.5, 10)).toBe(true)
  })
  it('marcas "del futuro" (tras un reinicio) no bloquean para siempre', () => {
    const b = new NoteBudget()
    for (let i = 0; i < SOFT_CAP; i++) b.admit(100 + i * 0.01, 10)
    expect(b.admit(5, 10)).toBe(true)
  })
  it('el volumen baja con la densidad, sin pasar de 0.7', () => {
    expect(densityGain(4)).toBe(1)
    expect(densityGain(13)).toBeLessThan(1)
    expect(densityGain(100)).toBeCloseTo(0.7)
  })
})

describe('voces y tiempos seguros', () => {
  it('elige una voz libre; si todas suenan, la que termina antes', () => {
    expect(pickVoice([5, 0.5, 3], 1)).toBe(1)
    expect(pickVoice([5, 2, 3], 1)).toBe(1)
  })
  it('el inicio siempre es estrictamente mayor que el anterior y nunca en el pasado', () => {
    expect(safeStart(1, 1, 0)).toBeGreaterThan(1)
    expect(safeStart(0.5, 0, 2)).toBeGreaterThan(2)
    expect(safeStart(3, 1, 2)).toBe(3)
  })
})

describe('pasaje muy denso con el planificador real', () => {
  // 20 s con muchas tormentas grandes, nuevas, en océano y en todas las regiones.
  function run(withBudget: boolean) {
    const planner = new MelodyPlanner()
    const budget = new NoteBudget()
    const voices = Array.from({ length: 16 }, () => ({ busy: 0, last: -1, starts: [] as number[] }))
    const played: { t: number; midi: number; lead: boolean; region: string }[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < Math.round(20 / SLOT); k++) {
      const t = k * SLOT
      const pending = Array.from({ length: 9 }, () => strike({
        lat: rnd() * 80 - 40, lon: rnd() * 340 - 170, energy: 1000 + rnd() * 2400,
        neighbors: Math.floor(rnd() * 6), isNew: rnd() < 0.3, land: rnd() < 0.6,
      }))
      const plan = planner.planSlot(k % 4, pending, k < 70 ? 1 : 3)
      const items = plan.events.map((e) => ({ e, rank: rankOf(e.role === 'resolucion' ? 'resolucion' : e.role === 'acento' ? 'acento' : e.lead ? 'lider' : 'acompanante') }))
      for (let j = 0; j < 2; j++) items.push({ e: { midi: 90, offset: j * SLOT / 2, velocity: 0.3, duration: 0.05, pan: 0, timbre: 'marimba', role: 'melodia' }, rank: rankOf('destello') })
      items.sort((a, b) => b.rank - a.rank)
      for (const { e, rank } of items) {
        const time = t + e.offset
        if (withBudget && !budget.admit(time, rank)) continue
        if (rank > 10) {
          const vi = pickVoice(voices.map((v) => v.busy), time)
          const start = safeStart(time, voices[vi].last, t - 0.05)
          voices[vi].starts.push(start); voices[vi].last = start; voices[vi].busy = start + e.duration + 1
        }
        played.push({ t: time, midi: e.midi, lead: !!e.lead, region: plan.group?.region ?? '' })
      }
    }
    const perSec = Array.from({ length: 20 }, (_, s) => played.filter((p) => p.t >= s && p.t < s + 1).length)
    return { played, maxPerSec: Math.max(...perSec), voices }
  }

  it('sin presupuesto supera las 18 notas/s; con presupuesto nunca las pasa', () => {
    expect(run(false).maxPerSec).toBeGreaterThan(HARD_CAP)
    expect(run(true).maxPerSec).toBeLessThanOrEqual(HARD_CAP)
  })
  it('ninguna voz recibe un inicio que no sea estrictamente creciente', () => {
    for (const v of run(true).voices)
      for (let i = 1; i < v.starts.length; i++) expect(v.starts[i]).toBeGreaterThan(v.starts[i - 1])
  })
  it('REGLA: la melodía con presupuesto es un subconjunto ordenado de la melodía sin presupuesto', () => {
    const full = run(false).played.filter((p) => p.lead).map((p) => `${p.t.toFixed(3)}:${p.midi}`)
    const cut = run(true).played.filter((p) => p.lead).map((p) => `${p.t.toFixed(3)}:${p.midi}`)
    let i = 0
    for (const x of cut) {
      while (i < full.length && full[i] !== x) i++
      expect(i).toBeLessThan(full.length) // cada nota con presupuesto existe, en el mismo orden
      i++
    }
  })
  it('REGLA: dentro de cada voz, la melodía nunca repite la misma nota dos veces seguidas', () => {
    const leads = run(true).played.filter((p) => p.lead)
    for (const r of ['oeste', 'centro', 'este']) {
      const seq = leads.filter((p) => p.region === r).map((p) => p.midi)
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1])
    }
  })
})
