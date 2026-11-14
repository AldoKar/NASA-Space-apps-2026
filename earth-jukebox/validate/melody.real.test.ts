// Compara la melodía anterior (nota suelta por latitud) con el planificador nuevo, sobre el video real.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector, type Strike } from '../src/analysis/detector'
import { SLOT, chordIndexFor, chordLadder, isMelodic, latToLadderIndex, pickForSlot, slotAllows } from '../src/audio/harmony'
import { MelodyPlanner, regionOf } from '../src/audio/melody'

const VIDEO = process.env.VIDEO ?? 'public/video/lightning-2048.mp4'

function stats(name: string, seq: number[]) {
  const iv = seq.slice(1).map((m, i) => Math.abs(m - seq[i]))
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length
  const leaps = iv.filter((x) => x > 7).length / iv.length
  const steps = iv.filter((x) => x <= 4).length / iv.length
  console.log(`${name.padEnd(26)} salto promedio ${mean.toFixed(1)} semitonos · saltos grandes (>7) ${(leaps * 100).toFixed(0)}% · pasos cortos (≤4) ${(steps * 100).toFixed(0)}% · repetidas ${((iv.filter((x) => x === 0).length / iv.length) * 100).toFixed(0)}%`)
}

it.skipIf(!existsSync(VIDEO))('melodía antes vs después', async () => {
  const det = new LightningDetector()
  const configs = [
    { phraseLength: 1, resolveBelow: 0.45, resetAbove: 0.7 },
    { phraseLength: 2, resolveBelow: 0.55, resetAbove: 0.8 },
    { phraseLength: 3, resolveBelow: 0.6, resetAbove: 0.85 },
    { phraseLength: 3, resolveBelow: 0.65, resetAbove: 0.9 },
    { phraseLength: 4, resolveBelow: 0.7, resetAbove: 0.9 },
  ]
  const sweep = configs.map((c) => ({ c, pl: new MelodyPlanner(c), regions: [] as string[], res: 0 }))
  const planner = new MelodyPlanner()
  const size = ANALYSIS_W * ANALYSIS_H * 3
  const p = spawn('ffmpeg', ['-v', 'error', '-i', VIDEO, '-vf', `scale=${ANALYSIS_W}:${ANALYSIS_H}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const rgba = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  let buf = Buffer.alloc(0), n = 0, chord = -1, nextSlot = SLOT, oldLast = -1
  let pending: Strike[] = []
  const oldSeq: number[] = [], newSeq: number[] = [], regions: string[] = []
  const perVoice: Record<string, number[]> = { oeste: [], centro: [], este: [] }
  let up = 0, down = 0, single = 0, resolutions = 0, groups = 0
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= size) {
      const fr = buf.subarray(0, size); buf = buf.subarray(size)
      for (let i = 0, j = 0; i < size; i += 3, j += 4) { rgba[j] = fr[i]; rgba[j + 1] = fr[i + 1]; rgba[j + 2] = fr[i + 2]; rgba[j + 3] = 255 }
      const t = n / 30
      const f = det.analyze(rgba, t)
      if (f.activity > 0.01) chord = chordIndexFor(f.meanLat, chord)
      for (const s of f.strikes) if (isMelodic(s)) pending.push(s)
      while (nextSlot <= t) {
        const ci = Math.max(chord, 0)
        const sub = Math.round(nextSlot / SLOT) % 4
        // Antes: nota suelta por latitud
        if (slotAllows(sub, pending.length)) {
          const [s] = pickForSlot(pending)
          const lad = chordLadder(ci)
          const i = latToLadderIndex(s.lat, lad.length, oldLast); oldLast = i
          oldSeq.push(lad[i])
        }
        for (const sw of sweep) { const rr = sw.pl.planSlot(sub, pending, ci); if (rr.resolution) sw.res++; if (rr.group) sw.regions.push(rr.group.region) }
        // Después: planificador
        const r = planner.planSlot(sub, pending, ci)
        if (r.resolution) resolutions++
        if (r.group) {
          groups++
          newSeq.push(r.group.midi); regions.push(r.group.region); perVoice[r.group.region].push(r.group.midi)
          r.group.direction === 1 ? up++ : r.group.direction === -1 ? down++ : single++
        }
        pending = []; nextSlot += SLOT
      }
      n++
    }
  }
  stats('ANTES (todas las notas)', oldSeq)
  stats('DESPUÉS (todas las notas)', newSeq)
  for (const r of ['oeste', 'centro', 'este']) stats(`  después · voz ${r}`, perVoice[r])
  const alt = regions.slice(1).filter((r, i) => r !== regions[i]).length / (regions.length - 1)
  console.log(`regiones: ${['oeste', 'centro', 'este'].map((r) => `${r} ${((perVoice[r].length / groups) * 100).toFixed(0)}%`).join(' · ')}`)
  console.log(`conversación: ${(alt * 100).toFixed(0)}% de las notas consecutivas cambian de región`)
  console.log(`arpegios ↑ ${up} · ↓ ${down} · una nota ${single}`)
  console.log(`resoluciones en la calma: ${resolutions} en ${(n / 30).toFixed(0)} s`)
  for (const sw of sweep) {
    const a = sw.regions.slice(1).filter((r, i) => r !== sw.regions[i]).length / (sw.regions.length - 1)
    console.log(`config frase=${sw.c.phraseLength} resolver<${sw.c.resolveBelow} → cambia de región ${(a * 100).toFixed(0)}% · resoluciones ${sw.res}`)
  }
  void regionOf
}, 600_000)
