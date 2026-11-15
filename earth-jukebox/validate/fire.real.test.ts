// Validación del detector del incendio con el video web real (solo desarrollo; requiere ffmpeg).
import { existsSync } from 'node:fs'
import { it } from 'vitest'
import type { FireFeatures } from '../src/analysis/fireDetector'
import { FIRE_VIDEO as VIDEO, readFire } from './fireReader'
import { fireDateLabel, fireDay } from '../src/analysis/fireTimeline'


it.skipIf(!existsSync(VIDEO))('detector del incendio sobre el video completo', async () => {
  const rows: { t: number; f: FireFeatures }[] = []
  await readFire((f, t) => rows.push({ t, f }))
  console.log(' seg  fecha         activo  frente  lado   quemado  crecim.  resumen')
  for (let s = 0; s < 103; s += 3) {
    const seg = rows.filter((r) => r.t >= s && r.t < s + 3)
    if (!seg.length) break
    const avg = (k: keyof FireFeatures) => seg.reduce((a, r) => a + (r.f[k] as number), 0) / seg.length
    const xs = seg.map((r) => r.f.frontX).filter((x) => x >= 0)
    console.log(`${String(s).padStart(4)}  ${fireDateLabel(fireDay(s)).padEnd(12)}  ${avg('active').toFixed(2)}    ${avg('front').toFixed(2)}   ${xs.length ? (xs.reduce((a, b) => a + b) / xs.length).toFixed(2) : ' -  '}   ${avg('burned').toFixed(2)}     ${avg('growth').toFixed(2)}     ${seg.some((r) => r.f.recap) ? 'sí' : ''}`)
  }
}, 600_000)
