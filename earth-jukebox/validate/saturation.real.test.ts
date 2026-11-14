// Mide saturación con el video real: notas/s en ventanas de 1 s y notas que suenan a la vez por instrumento.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector } from '../src/analysis/detector'
import { SLOT, chordIndexFor, isMelodic, textureTicks } from '../src/audio/harmony'
import { MelodyPlanner, SlotQueue } from '../src/audio/melody'
import { NoteBudget, densityGain, pickVoice, rankOf } from '../src/audio/budget'

const VIDEO = process.env.VIDEO ?? 'public/video/lightning-2048.mp4'
// Duración audible aproximada de cada nota (nota + cola de la envolvente) según el motor actual.
const RING = { marimba: 1.0, campana: 1.8 } // release 1.0 / 1.8 s

it.skipIf(!existsSync(VIDEO))('saturación con el video real', async () => {
  const det = new LightningDetector()
  const planner = new MelodyPlanner()
  const size = ANALYSIS_W * ANALYSIS_H * 3
  const p = spawn('ffmpeg', ['-v', 'error', '-i', VIDEO, '-vf', `scale=${ANALYSIS_W}:${ANALYSIS_H}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const rgba = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  let buf = Buffer.alloc(0), n = 0, chord = -1, nextSlot = SLOT
  let small = 0
  const queue = new SlotQueue()
  const notes: { t: number; kind: string; end: number }[] = []
  const kept: { t: number; kind: string; end: number }[] = []
  const budget = new NoteBudget()
  const pools: Record<string, number[]> = { marimba: Array(20).fill(0), campana: Array(8).fill(0) }
  let steals = 0, gains: number[] = [], leadAll = 0, leadKept = 0
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= size) {
      const fr = buf.subarray(0, size); buf = buf.subarray(size)
      for (let i = 0, j = 0; i < size; i += 3, j += 4) { rgba[j] = fr[i]; rgba[j + 1] = fr[i + 1]; rgba[j + 2] = fr[i + 2]; rgba[j + 3] = 255 }
      const t = n / 30
      const f = det.analyze(rgba, t)
      if (f.activity > 0.01) chord = chordIndexFor(f.meanLat, chord)
      for (const s of f.strikes) { queue.add(s); if (!isMelodic(s)) small++ }
      while (nextSlot <= t) {
        const sub = Math.round(nextSlot / SLOT) % 4
        const tk = queue.take(sub)
        const r = planner.planSlot(sub, tk.candidates, Math.max(chord, 0), tk.arrivals)
        queue.endSlot(sub, r.group !== null)
        const items: { rank: number; n: { t: number; kind: string; end: number } }[] = []
        for (const e of r.events) {
          const n = { t: nextSlot + e.offset, kind: e.timbre, end: nextSlot + e.offset + e.duration + RING[e.timbre] }
          notes.push(n); if (e.lead) leadAll++
          items.push({ rank: rankOf(e.role === 'resolucion' ? 'resolucion' : e.role === 'acento' ? 'acento' : e.lead ? 'lider' : 'acompanante'), n })
        }
        for (let k = 0; k < textureTicks(small); k++) {
          const n = { t: nextSlot + (k * SLOT) / 2, kind: 'destello', end: nextSlot + 0.3 }
          notes.push(n); items.push({ rank: rankOf('destello'), n })
        }
        items.sort((a, b) => b.rank - a.rank)
        gains.push(densityGain(budget.recent(nextSlot)))
        for (const it of items) {
          if (!budget.admit(it.n.t, it.rank)) continue
          kept.push(it.n); if (it.rank === 90) leadKept++
          const pool = pools[it.n.kind]
          if (pool) {
            const vi = pickVoice(pool, it.n.t)
            if (pool[vi] > it.n.t) steals++
            pool[vi] = it.n.end
          }
        }
        small = 0; nextSlot += SLOT
      }
      n++
    }
  }
  const dur = Math.floor(n / 30)
  const perSec = Array.from({ length: dur }, (_, s) => notes.filter((x) => x.t >= s && x.t < s + 1).length)
  const melodicPerSec = Array.from({ length: dur }, (_, s) => notes.filter((x) => x.kind !== 'destello' && x.t >= s && x.t < s + 1).length)
  const pc = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)]
  console.log(`ANTES → notas/s totales (incl. destellos): mediana ${pc(perSec, 0.5)} · p90 ${pc(perSec, 0.9)} · máx ${Math.max(...perSec)}`)
  console.log(`ANTES → notas/s melódicas: mediana ${pc(melodicPerSec, 0.5)} · p90 ${pc(melodicPerSec, 0.9)} · máx ${Math.max(...melodicPerSec)}`)
  const perSecK = Array.from({ length: dur }, (_, s) => kept.filter((x) => x.t >= s && x.t < s + 1).length)
  console.log(`CON CONTROL → notas/s: mediana ${pc(perSecK, 0.5)} · p90 ${pc(perSecK, 0.9)} · máx ${Math.max(...perSecK)} · omitidas ${(((notes.length - kept.length) / notes.length) * 100).toFixed(0)}% (de ellas destellos: ${(((notes.filter((x) => x.kind === 'destello').length - kept.filter((x) => x.kind === 'destello').length) / Math.max(1, notes.length - kept.length)) * 100).toFixed(0)}%)`)
  const melAll = notes.filter((x) => x.kind !== 'destello').length, melKept = kept.filter((x) => x.kind !== 'destello').length
  console.log(`CON CONTROL → notas melódicas conservadas: ${((melKept / melAll) * 100).toFixed(1)}% · notas que cortan a otra (20+8 voces por disponibilidad): ${((steals / melKept) * 100).toFixed(1)}% · volumen por densidad: mín ${Math.min(...gains).toFixed(2)}`)
  console.log(`CON CONTROL → notas LÍDER de la melodía conservadas: ${((leadKept / leadAll) * 100).toFixed(1)}%`)
  for (const [kind, voices] of [['marimba', 10], ['campana', 4]] as const) {
    const list = notes.filter((x) => x.kind === kind)
    let maxC = 0, over = 0
    for (const x of list) {
      const c = list.filter((y) => y.t <= x.t && y.end > x.t).length
      maxC = Math.max(maxC, c); if (c > voices) over++
    }
    console.log(`ANTES ${kind === 'marimba' ? 'piano eléctrico' : 'vibráfono'}: hasta ${maxC} notas sonando a la vez (hay ${voices} voces) → ${((over / list.length) * 100).toFixed(0)}% de las notas cortan otra que seguía sonando`)
  }
}, 600_000)
