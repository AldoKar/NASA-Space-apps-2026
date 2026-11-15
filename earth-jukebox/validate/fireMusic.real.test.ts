// Simula la música del incendio sobre el video real con la misma lógica que FireEngine.
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import { FIRE_VIDEO, readFire } from './fireReader'
import { fireDateLabel, fireDay } from '../src/analysis/fireTimeline'
import { NoteBudget, rankOf } from '../src/audio/budget'
import {
  FIRE_CHORDS, FIRE_SLOT, FRONT_RANGE, crackleCount, fireChordFor, fireIntensity, fireLadder,
  firePhase, frontAllows, heartbeat, nextFrontIndex,
} from '../src/audio/fireMusic'

it.skipIf(!existsSync(FIRE_VIDEO))('música del incendio sobre el video completo', async () => {
  let intensity = 0, trend = 0, chord = -1, frontIdx = -1, next = FIRE_SLOT, lastT = 0, codaAt = -1, prevMidi = -1
  const budget = new NoteBudget()
  const events: { t: number; kind: string }[] = []
  const phases: { t: number; phase: string; chord: string }[] = []
  let leaps = 0, steps = 0, repeats = 0
  await readFire((f, t) => {
    const dt = t - lastT || 1 / 30; lastT = t
    if (f.recap) { if (codaAt < 0) codaAt = t; return }
    const prev = intensity
    intensity += (fireIntensity(f.active, f.front) - intensity) * Math.min(1, dt / 1.5)
    trend = trend * 0.9 + ((intensity - prev) / dt) * 0.1
    chord = fireChordFor(intensity, chord)
    while (next <= t) {
      const sub = Math.round(next / FIRE_SLOT) % 4
      const items: { rank: number; kind: string }[] = []
      if (frontAllows(sub, f.front)) {
        const lad = fireLadder(chord, FRONT_RANGE[0], FRONT_RANGE[1])
        frontIdx = nextFrontIndex(f.front, lad.length, Math.min(frontIdx, lad.length - 1))
        const m = lad[frontIdx]
        if (prevMidi >= 0) { const d = Math.abs(m - prevMidi); if (d > 7) leaps++; else steps++; if (d === 0) repeats++ }
        prevMidi = m
        items.push({ rank: rankOf('lider'), kind: 'melodía' })
      }
      for (let i = 0; i < crackleCount(sub, f.active); i++) items.push({ rank: rankOf('destello'), kind: 'crepitar' })
      if (heartbeat(sub, f.active)) items.push({ rank: rankOf('acompanante'), kind: 'latido' })
      items.sort((a, b) => b.rank - a.rank)
      for (const it of items) if (budget.admit(next, it.rank)) events.push({ t: next, kind: it.kind })
      next += FIRE_SLOT
    }
    const ph = firePhase(intensity, trend, false)
    const last = phases[phases.length - 1]
    if (!last || last.phase !== ph || last.chord !== FIRE_CHORDS[chord].name) phases.push({ t, phase: ph, chord: FIRE_CHORDS[chord].name })
  })
  console.log(' tramo   fechas                 melodía/s  crepitar/s  latidos   fase dominante · acorde')
  for (let s = 0; s < 96; s += 8) {
    const seg = events.filter((e) => e.t >= s && e.t < s + 8)
    const c = (k: string) => (seg.filter((e) => e.kind === k).length / 8).toFixed(1)
    const ph = phases.filter((p) => p.t < s + 8).slice(-1)[0]
    console.log(` ${String(s).padStart(2)}–${String(s + 8).padStart(2)}s  ${fireDateLabel(fireDay(s)).padEnd(11)}→ ${fireDateLabel(fireDay(Math.min(s + 8, 95))).padEnd(11)}  ${c('melodía').padStart(5)}      ${c('crepitar').padStart(5)}      ${seg.filter((e) => e.kind === 'latido').length.toString().padStart(3)}     ${ph?.phase} · ${ph?.chord}`)
  }
  const perSec = Array.from({ length: 96 }, (_, s) => events.filter((e) => e.t >= s && e.t < s + 1).length)
  console.log(`notas totales/s: máx ${Math.max(...perSec)} · omitidas por saturación ${budget.dropped}`)
  console.log(`melodía del frente: saltos grandes (>7 semitonos) ${((leaps / Math.max(1, leaps + steps)) * 100).toFixed(0)}% · repetidas ${repeats}`)
  console.log(`cambios de acorde: ${phases.filter((p, i) => i > 0 && p.chord !== phases[i - 1].chord).length} · cierre (resumen) en ${codaAt.toFixed(1)} s`)
}, 600_000)
