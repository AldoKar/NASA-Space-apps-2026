// Validación con el video real (solo para desarrollo; requiere ffmpeg y el video en public/video).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector } from '../src/analysis/detector'

const VIDEO = process.env.VIDEO ?? 'public/video/lightning-2048.mp4'

it.skipIf(!existsSync(VIDEO))('analiza el video completo', async () => {
  const det = new LightningDetector()
  const fs = 30
  const size = ANALYSIS_W * ANALYSIS_H * 3
  const p = spawn('ffmpeg', ['-v', 'error', '-i', VIDEO, '-vf', `scale=${ANALYSIS_W}:${ANALYSIS_H}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  let buf = Buffer.alloc(0)
  const rgba = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  let n = 0
  const perSec: { act: number; lat: number; newRate: number; strikes: number; thunder: number; budgetNotes: number }[] = []
  let budget = 0
  let notes = 0
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= size) {
      const fr = buf.subarray(0, size)
      buf = buf.subarray(size)
      for (let i = 0, j = 0; i < size; i += 3, j += 4) { rgba[j] = fr[i]; rgba[j + 1] = fr[i + 1]; rgba[j + 2] = fr[i + 2]; rgba[j + 3] = 255 }
      const f = det.analyze(rgba, n / fs)
      // misma lógica de presupuesto de notas que el motor
      if (f.strikes.length && !f.isReset) {
        budget = Math.min(budget + (1.5 + 12.5 * f.newRate) / fs, 4)
        const k = Math.min(Math.floor(budget), f.strikes.length)
        budget -= k; notes += k
      }
      const s = Math.floor(n / fs)
      perSec[s] ??= { act: 0, lat: 0, newRate: 0, strikes: 0, thunder: 0, budgetNotes: 0 }
      const r = perSec[s]
      r.act = Math.max(r.act, f.activity); r.lat = f.meanLat; r.newRate += f.newRate / fs; r.strikes += f.strikes.length
      if (f.peakEnergy > 2200) r.thunder++
      r.budgetNotes = notes
      n++
    }
  }
  let prevNotes = 0
  for (let s = 0; s < perSec.length; s += 4) {
    const r = perSec[s]
    console.log(`${String(s).padStart(3)}s act=${r.act.toFixed(2)} lat=${r.lat.toFixed(1).padStart(6)} newRate=${r.newRate.toFixed(2)} cellsNew/s=${r.strikes} thunderFrames=${r.thunder} notes/s≈${r.budgetNotes - (perSec[s - 1]?.budgetNotes ?? 0)}`)
    prevNotes = r.budgetNotes
  }
  console.log('frames', n, 'total notes', notes, prevNotes >= 0 ? '' : '')
}, 600_000)
