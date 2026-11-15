/**
 * Detector de voz (VAD) por energía, pensado para lugares con ruido.
 *
 * Corta el audio del micrófono en frases: una frase empieza cuando el nivel supera claramente el ruido
 * de fondo y termina tras un silencio corto.
 *
 * El ruido de fondo se mide con los PICOS de los últimos 3 segundos (percentil 90), no con el promedio:
 * con gente platicando alrededor, la línea queda por encima de esa plática y solo cruza una voz más
 * fuerte, la de quien está pegado al micrófono. Lo que dura demasiado (plática continua, música) se
 * descarta sin mandarlo a Whisper: un comando dura uno o dos segundos.
 */

export interface VadOptions {
  sampleRate: number
  /** Duración de cada cuadro de análisis. */
  frameMs?: number
  /** Sensibilidad 0–1: más alta, cuenta como voz con menos diferencia sobre el ruido (0.5 = 12 dB). */
  sensitivity?: number
  /** Nivel mínimo absoluto para contar como voz (evita disparos en silencio total). */
  minDb?: number
  /** Audio previo que se agrega al inicio de la frase (para no cortar la primera sílaba). */
  preRollMs?: number
  /** Silencio que cierra la frase. */
  hangMs?: number
  /** Frases más cortas se descartan (golpes, toses). */
  minSpeechMs?: number
  /** Lo que dura más que esto se descarta (plática continua). */
  maxSegmentMs?: number
  /** Ventana para medir el ruido de fondo. */
  noiseWindowMs?: number
  /** Tiempo inicial para medir el ruido antes de detectar. */
  calibrationMs?: number
}

export type DropReason = 'muy-corto' | 'muy-largo'

/** Sensibilidad 0–1 → cuántos dB sobre el ruido cuenta como voz (0 → 20 dB, 1 → 4 dB). */
export const marginForSensitivity = (s: number) => 20 - 16 * Math.max(0, Math.min(1, s))

export class SpeechSegmenter {
  private readonly frame: number
  private readonly o: Required<VadOptions>
  private readonly onSegment: (audio: Float32Array) => void
  private readonly onSpeaking?: (on: boolean) => void
  private readonly onDrop?: (reason: DropReason, seconds: number) => void
  private margin: number
  private pending = new Float32Array(0)
  private pendingLen = 0
  private floorDb = -60
  private history: number[] = [] // niveles recientes sin voz, para medir el ruido
  private sinceFloor = 0
  private elapsed = 0
  private speaking = false
  private run = 0 // cuadros seguidos con voz
  private silence = 0 // ms de silencio dentro de una frase
  private speechMs = 0
  private preRoll: Float32Array[] = []
  private segment: Float32Array[] = []
  private segmentDb: number[] = []
  private segmentMs = 0
  lastDb = -100

  constructor(
    opts: VadOptions,
    onSegment: (audio: Float32Array) => void,
    onSpeaking?: (on: boolean) => void,
    onDrop?: (reason: DropReason, seconds: number) => void,
  ) {
    this.onSegment = onSegment
    this.onSpeaking = onSpeaking
    this.onDrop = onDrop
    this.o = {
      frameMs: 20, sensitivity: 0.5, minDb: -50, preRollMs: 300, hangMs: 550, minSpeechMs: 250,
      maxSegmentMs: 4500, noiseWindowMs: 3000, calibrationMs: 800,
      ...opts,
    }
    this.margin = marginForSensitivity(this.o.sensitivity)
    this.frame = Math.round((this.o.sampleRate * this.o.frameMs) / 1000)
    this.pending = new Float32Array(this.frame)
  }

  get noiseFloorDb() {
    return this.floorDb
  }
  /** Nivel a partir del cual cuenta como voz. */
  get thresholdDb() {
    return Math.max(this.floorDb + this.margin, this.o.minDb)
  }
  get isSpeaking() {
    return this.speaking
  }

  setSensitivity(s: number) {
    this.margin = marginForSensitivity(s)
  }

  /** Agrega audio del micrófono (cualquier tamaño). */
  push(chunk: Float32Array) {
    for (let i = 0; i < chunk.length; i++) {
      this.pending[this.pendingLen++] = chunk[i]
      if (this.pendingLen === this.frame) {
        this.process(this.pending.slice())
        this.pendingLen = 0
      }
    }
  }

  /** Recuerda un nivel sin voz y recalcula el ruido de fondo (percentil 90 de los últimos segundos). */
  private learn(db: number) {
    const max = Math.ceil(this.o.noiseWindowMs / this.o.frameMs)
    this.history.push(db)
    if (this.history.length > max) this.history.splice(0, this.history.length - max)
    if (++this.sinceFloor >= 5 || this.history.length < 10) {
      this.sinceFloor = 0
      const sorted = [...this.history].sort((a, b) => a - b)
      this.floorDb = Math.min(-15, Math.max(-80, sorted[Math.floor((sorted.length - 1) * 0.9)]))
    }
  }

  private process(f: Float32Array) {
    let sum = 0
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i]
    const db = 10 * Math.log10(sum / f.length + 1e-12)
    this.lastDb = db
    const { frameMs } = this.o

    // Calibración: mide el ruido del lugar antes de empezar a detectar.
    if (this.elapsed < this.o.calibrationMs) {
      this.elapsed += frameMs
      this.learn(db)
      this.keepPreRoll(f)
      return
    }

    const isVoice = db > this.thresholdDb

    if (!this.speaking) {
      this.keepPreRoll(f)
      this.run = isVoice ? this.run + 1 : 0
      if (!isVoice) this.learn(db)
      if (this.run >= 3) {
        this.speaking = true
        this.segment = [...this.preRoll]
        this.segmentDb = []
        this.segmentMs = this.preRoll.length * frameMs
        this.speechMs = this.run * frameMs
        this.silence = 0
        this.preRoll = []
        this.onSpeaking?.(true)
      }
      return
    }

    this.segment.push(f)
    this.segmentDb.push(db)
    this.segmentMs += frameMs
    if (isVoice) {
      this.speechMs += frameMs
      this.silence = 0
    } else {
      this.silence += frameMs
    }
    if (this.silence >= this.o.hangMs) this.close()
    else if (this.segmentMs >= this.o.maxSegmentMs) this.drop()
  }

  private keepPreRoll(f: Float32Array) {
    this.preRoll.push(f)
    const max = Math.ceil(this.o.preRollMs / this.o.frameMs)
    if (this.preRoll.length > max) this.preRoll.shift()
  }

  private reset() {
    this.speaking = false
    this.run = 0
    this.segment = []
    this.segmentDb = []
    this.segmentMs = 0
    this.speechMs = 0
    this.silence = 0
    this.onSpeaking?.(false)
  }

  /** Demasiado largo: es plática o ruido continuo. Se descarta y se aprende como ruido de fondo. */
  private drop() {
    const seconds = this.segmentMs / 1000
    const levels = this.segmentDb
    this.reset()
    for (const db of levels) this.learn(db)
    this.onDrop?.('muy-largo', seconds)
  }

  private close() {
    const enough = this.speechMs >= this.o.minSpeechMs
    const parts = this.segment
    const seconds = this.segmentMs / 1000
    this.reset()
    if (!enough) { this.onDrop?.('muy-corto', seconds); return }
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Float32Array(total)
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    this.onSegment(out)
  }

  /** Cierra la frase en curso (al detener el micrófono). */
  flush() {
    if (this.speaking) this.close()
  }
}

/**
 * Whisper a veces "inventa" texto con ruido o silencio ("Thanks for watching", "Subtitles by Amara.org").
 * Devuelve el texto limpio, o '' si es una de esas frases o no tiene palabras.
 */
export function cleanTranscript(text: string): string {
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const n = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!n || !/[a-zñ]/.test(n)) return ''
  const junk = [
    /amara ?org/, /subtitles? by/, /captions? by/, /thanks? (you )?for watching/, /thank you for listening/,
    /please subscribe/, /like and subscribe/, /dont forget to subscribe/, /see you (in the )?next/,
    /^thank you$/, /^thanks$/, /^you$/, /^bye$/, /^music$/, /^applause$/, /^laughter$/, /^silence$/,
    /^blank audio$/, /^ah+$/, /^uh+$/, /^um+$/, /^mm+$/, /^hm+$/, /^oh$/, /^so$/, /^okay$/,
  ]
  return junk.some((re) => re.test(n)) ? '' : t
}
