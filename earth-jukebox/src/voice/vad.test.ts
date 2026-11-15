import { describe, expect, it } from 'vitest'
import { cleanTranscript, SpeechSegmenter, type DropReason } from './vad'

const SR = 16000
/** Ruido o "voz" sintética a un nivel en dBFS (RMS), durante ms milisegundos. */
function sound(db: number, ms: number, seed = 1): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const amp = Math.pow(10, db / 20) * Math.sqrt(3) // ruido uniforme: RMS = amp/√3
  const out = new Float32Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    out[i] = (x / 2147483648 * 2 - 1) * amp
  }
  return out
}

function run(parts: Float32Array[], sensitivity = 0.5) {
  const segs: Float32Array[] = []
  const drops: DropReason[] = []
  const v = new SpeechSegmenter({ sampleRate: SR, sensitivity }, (a) => segs.push(a), undefined, (r) => drops.push(r))
  for (const p of parts) v.push(p)
  v.flush()
  return { segs, drops, v }
}

/** Plática alrededor: ráfagas de voz a un nivel, con pausas cortas. */
function chatter(db: number, ms: number, seed = 3) {
  const parts: Float32Array[] = []
  let t = 0
  let k = seed
  while (t < ms) {
    const on = 300 + ((k * 7919) % 900)
    const off = 120 + ((k * 104729) % 300)
    parts.push(sound(db + ((k % 5) - 2), on, k), sound(db - 18, off, k + 1))
    t += on + off
    k++
  }
  return parts
}

describe('SpeechSegmenter', () => {
  it('corta una frase hablada en un lugar silencioso', () => {
    const { segs } = run([sound(-65, 1200), sound(-20, 900), sound(-65, 1200)])
    expect(segs.length).toBe(1)
    const ms = (segs[0].length / SR) * 1000
    expect(ms).toBeGreaterThan(900)
    expect(ms).toBeLessThan(2000)
  })

  it('con murmullo constante, no dispara; una voz cercana más fuerte sí', () => {
    const { segs, v } = run([sound(-35, 3000), sound(-12, 800, 7), sound(-35, 1500, 9)])
    expect(segs.length).toBe(1)
    expect(v.noiseFloorDb).toBeGreaterThan(-40)
  })

  it('el murmullo que sube poco a poco no cuenta como frase', () => {
    const parts = []
    for (let db = -60; db <= -30; db += 2) parts.push(sound(db, 400, db + 100))
    const { segs } = run(parts)
    expect(segs.length).toBe(0)
  })

  it('descarta golpes cortos', () => {
    const { segs } = run([sound(-65, 1200), sound(-15, 60), sound(-65, 1000)])
    expect(segs.length).toBe(0)
  })

  it('descarta lo que dura demasiado (ruido o plática continua) y lo aprende como fondo', () => {
    const { segs, drops, v } = run([sound(-65, 1200), sound(-15, 9000), sound(-65, 300)])
    expect(segs.length).toBe(0)
    expect(drops).toContain('muy-largo')
    expect(v.noiseFloorDb).toBeGreaterThan(-25)
  })

  it('con gente platicando alrededor solo pasa la voz pegada al micrófono', () => {
    const talk = chatter(-32, 6000)
    const { segs } = run([...talk, sound(-12, 900, 42), ...chatter(-32, 2500, 11)])
    expect(segs.length).toBe(1)
    const ms = (segs[0].length / SR) * 1000
    expect(ms).toBeGreaterThan(900)
  })

  it('la sensibilidad cambia lo que cuenta como voz', () => {
    const quiet = [sound(-60, 1200), sound(-48, 900, 5), sound(-60, 1200)]
    expect(run(quiet, 0.2).segs.length).toBe(0)
    expect(run(quiet, 0.9).segs.length).toBe(1)
  })
})

describe('cleanTranscript', () => {
  it('deja pasar comandos', () => {
    expect(cleanTranscript(' Pause the simulator.')).toBe('Pause the simulator.')
    expect(cleanTranscript('Skip 10 seconds')).toBe('Skip 10 seconds')
  })
  it('descarta lo que Whisper inventa con ruido', () => {
    for (const t of ['Thanks for watching!', 'Thank you for watching.', 'Subtitles by the Amara.org community', '[Music]', 'Please subscribe!', '...', ' ', 'Mmm.', 'you', '[BLANK_AUDIO]']) {
      expect(cleanTranscript(t)).toBe('')
    }
  })
})

import { toWavBase64 } from './whisperListener'
describe('toWavBase64', () => {
  it('arma un WAV de 16 bits a 16 kHz', () => {
    const b64 = toWavBase64(new Float32Array([0, 0.5, -0.5, 1]), 16000)
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const v = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(8)
    expect(v.getInt16(46, true)).toBe(16383)
    expect(v.getInt16(48, true)).toBe(-16384)
  })
})
