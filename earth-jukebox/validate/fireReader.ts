// Lector compartido del video del incendio (solo desarrollo; requiere ffmpeg).
import { spawn } from 'node:child_process'
import { FIRE_H, FIRE_W, FireDetector, type FireFeatures } from '../src/analysis/fireDetector'

export const FIRE_VIDEO = process.env.FIRE_VIDEO ?? 'public/video/dixie-fire-720.mp4'

export async function readFire(onFrame: (f: FireFeatures, t: number) => void) {
  const det = new FireDetector()
  const size = FIRE_W * FIRE_H * 3
  const p = spawn('ffmpeg', ['-v', 'error', '-i', FIRE_VIDEO, '-vf', `scale=${FIRE_W}:${FIRE_H}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const rgba = new Uint8ClampedArray(FIRE_W * FIRE_H * 4)
  let buf = Buffer.alloc(0), n = 0
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= size) {
      const fr = buf.subarray(0, size); buf = buf.subarray(size)
      for (let i = 0, j = 0; i < size; i += 3, j += 4) { rgba[j] = fr[i]; rgba[j + 1] = fr[i + 1]; rgba[j + 2] = fr[i + 2]; rgba[j + 3] = 255 }
      onFrame(det.analyze(rgba, n / 30), n / 30)
      n++
    }
  }
  return n
}

