// Simulación del sonido sobre el video real (solo desarrollo; requiere ffmpeg y el video).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector, type Strike } from '../src/analysis/detector'
import { SLOT, chordIndexFor, chordLadder, isMelodic, latToLadderIndex, pickForSlot, slotAllows, textureTicks, voicing } from '../src/audio/harmony'

const VIDEO = process.env.VIDEO ?? 'public/video/lightning-2048.mp4'

it.skipIf(!existsSync(VIDEO))('simula la capa de rayos sobre el video completo', async () => {
  const det = new LightningDetector()
  const size = ANALYSIS_W * ANALYSIS_H * 3
  const p = spawn('ffmpeg', ['-v', 'error', '-i', VIDEO, '-vf', `scale=${ANALYSIS_W}:${ANALYSIS_H}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const rgba = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  let buf = Buffer.alloc(0), n = 0, chord = -1, nextSlot = SLOT, last = -1
  let pending: Strike[] = [], small = 0
  const slots: { notes: number; groups: number; ticks: number; thunder: boolean }[] = []
  const voicings = [0, 0, 0, 0], kinds = { land: 0, ocean: 0, nueva: 0 }
  let lastThunder = -9
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= size) {
      const fr = buf.subarray(0, size); buf = buf.subarray(size)
      for (let i = 0, j = 0; i < size; i += 3, j += 4) { rgba[j] = fr[i]; rgba[j + 1] = fr[i + 1]; rgba[j + 2] = fr[i + 2]; rgba[j + 3] = 255 }
      const t = n / 30
      const f = det.analyze(rgba, t)
      if (f.activity > 0.01) chord = chordIndexFor(f.meanLat, chord)
      for (const s of f.strikes) isMelodic(s) ? pending.push(s) : small++
      while (nextSlot <= t) {
        const ladder = chordLadder(Math.max(chord, 0))
        const sub = Math.round(nextSlot / SLOT) % 4
        const chosen = slotAllows(sub, pending.length) ? pickForSlot(pending) : []
        let notes = 0, thunder = false
        for (const s of chosen) {
          const root = latToLadderIndex(s.lat, ladder.length, last); last = root
          const v = voicing(root, s.neighbors); voicings[v.length]++; notes += v.length
          s.land ? kinds.land++ : kinds.ocean++; if (s.isNew) kinds.nueva++
          if (s.energy >= 2500 && nextSlot - lastThunder > 4) { thunder = true; lastThunder = nextSlot }
        }
        slots.push({ notes, groups: chosen.length, ticks: textureTicks(small), thunder })
        pending = []; small = 0; nextSlot += SLOT
      }
      n++
    }
  }
  const active = slots.filter((_, i) => i * SLOT > 4 && i * SLOT < 95)
  const pct = (x: number) => ((x / active.length) * 100).toFixed(1) + '%'
  const g = active.map((s) => s.groups)
  const groupsTotal = kinds.land + kinds.ocean
  console.log(`tiempos del pulso analizados: ${active.length} (${SLOT.toFixed(3)} s cada uno)`)
  console.log(`  silencio melódico (0 grupos): ${pct(g.filter((x) => x === 0).length)}  · 1 grupo: ${pct(g.filter((x) => x === 1).length)} · 2 grupos: ${pct(g.filter((x) => x === 2).length)}`)
  console.log(`  grupos melódicos por segundo: ${(g.reduce((a, b) => a + b, 0) / (active.length * SLOT)).toFixed(1)}`)
  console.log(`  notas por segundo (incl. arpegios): ${(active.reduce((a, s) => a + s.notes, 0) / (active.length * SLOT)).toFixed(1)}`)
  console.log(`  voicings → 1 nota: ${voicings[1]}, 2 notas: ${voicings[2]}, arpegio 3: ${voicings[3]}`)
  console.log(`  tierra: ${((kinds.land / groupsTotal) * 100).toFixed(0)}%  océano: ${((kinds.ocean / groupsTotal) * 100).toFixed(0)}%  con acento de tormenta nueva: ${((kinds.nueva / groupsTotal) * 100).toFixed(0)}%`)
  console.log(`  truenos: ${active.filter((s) => s.thunder).length} en ${(active.length * SLOT).toFixed(0)} s`)
  const tk = [0, 1, 2, 3].map((k) => pct(active.filter((s) => s.ticks === k).length))
  console.log(`  textura (chispazos por tiempo) 0/1/2/3: ${tk.join(' / ')}`)
  // Por tramos de 10 s: ¿la intensidad varía?
  for (let s0 = 5; s0 < 95; s0 += 10) {
    const seg = slots.filter((_, i) => i * SLOT >= s0 && i * SLOT < s0 + 10)
    const gps = seg.reduce((a, s) => a + s.groups, 0) / 10, tps = seg.reduce((a, s) => a + s.ticks, 0) / 10
    console.log(`  ${String(s0).padStart(2)}–${s0 + 10}s: ${gps.toFixed(1)} grupos/s, ${tps.toFixed(1)} chispazos/s, silencios ${((seg.filter((s) => s.groups === 0).length / seg.length) * 100).toFixed(0)}%`)
  }
}, 600_000)
