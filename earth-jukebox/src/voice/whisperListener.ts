import * as Tone from 'tone'
import { cleanTranscript, SpeechSegmenter, type DropReason } from './vad'

/**
 * Escucha con Whisper large-v3 (OpenRouter, a través de /api/transcribe): abre el micrófono con la
 * supresión de ruido y la cancelación de eco del navegador, corta las frases con el detector de voz y
 * manda cada una al servidor. Entrega cada frase como texto.
 */

export interface WhisperEvents {
  onText: (text: string) => void
  /** 'speech' mientras hablas, 'processing' mientras Whisper transcribe, 'idle' en espera. */
  onActivity?: (a: 'idle' | 'speech' | 'processing') => void
  /** Texto tal cual lo devolvió Whisper (antes de limpiarlo), con la duración del audio y lo que tardó. */
  onRaw?: (raw: string, info: { audioSeconds: number; ms: number }) => void
  /** Nivel del micrófono y piso de ruido en dB (cada 20 ms). */
  onLevel?: (level: { db: number; floorDb: number; thresholdDb: number; speaking: boolean }) => void
  /** Un sonido que no se mandó a Whisper: muy corto (golpe) o muy largo (plática o ruido continuo). */
  onDrop?: (reason: DropReason, seconds: number) => void
  /** El servidor falló varias veces seguidas (sin internet, sin saldo…). */
  onFatal?: (message: string) => void
}

/** Reconocedor de voz elegido: Whisper large (OpenRouter) o el de Chrome (Google). */
export type Recognizer = 'whisper' | 'chrome'
const RECOGNIZER_KEY = 'earth-symphony-reconocedor'
export function getRecognizer(): Recognizer {
  try { return localStorage.getItem(RECOGNIZER_KEY) === 'chrome' ? 'chrome' : 'whisper' } catch { return 'whisper' }
}
export function saveRecognizer(r: Recognizer) {
  try { localStorage.setItem(RECOGNIZER_KEY, r) } catch { /* sin almacenamiento */ }
}

/**
 * Nombre del micrófono predeterminado del sistema (el que usa Chrome para reconocer voz).
 * Solo se conoce después de dar permiso al micrófono.
 */
export async function defaultMicLabel(): Promise<string> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics = devices.filter((d) => d.kind === 'audioinput')
    const def = mics.find((d) => d.deviceId === 'default') ?? mics[0]
    return def?.label ? def.label.replace(/^(Default|Predeterminado|Predeterminada) - /i, '') : 'System default microphone'
  } catch {
    return 'System default microphone'
  }
}

/** Audio de 16 kHz a WAV de 16 bits, en base64 (lo que espera OpenRouter). */
export function toWavBase64(audio: Float32Array, sampleRate = 16000): string {
  const bytes = new Uint8Array(44 + audio.length * 2)
  const v = new DataView(bytes.buffer)
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + audio.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, audio.length * 2, true)
  for (let i = 0; i < audio.length; i++) {
    const x = Math.max(-1, Math.min(1, audio[i]))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const SENSITIVITY_KEY = 'earth-symphony-sensibilidad'
/** Sensibilidad del micrófono (0–1), guardada en el navegador: la ajustas en /test y la app usa la misma. */
export function getSensitivity(): number {
  try {
    const v = Number(localStorage.getItem(SENSITIVITY_KEY))
    return Number.isFinite(v) && localStorage.getItem(SENSITIVITY_KEY) !== null ? Math.max(0, Math.min(1, v)) : 0.5
  } catch {
    return 0.5
  }
}
export function saveSensitivity(v: number) {
  try { localStorage.setItem(SENSITIVITY_KEY, String(v)) } catch { /* sin almacenamiento */ }
}

const SAMPLE_RATE = 16000

/**
 * Procesador en el hilo de audio: baja el micrófono a 16 kHz (promediando, que además filtra los agudos)
 * y manda cuadros de 20 ms (320 muestras). Así el hilo principal recibe 50 mensajes por segundo.
 */
const TAP_WORKLET = `
class EsMicTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.acc = 0
    this.cnt = 0
    this.out = new Float32Array(320)
    this.n = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]
      this.cnt++
      this.pos += 1
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio
        this.out[this.n++] = this.acc / this.cnt
        this.acc = 0
        this.cnt = 0
        if (this.n === 320) {
          this.port.postMessage(this.out.slice())
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('es-mic-tap', EsMicTap)
`
const workletLoaded = new WeakSet<object>()

export class WhisperListener {
  private ready: Promise<string> | null = null
  private cloudFailures = 0
  private stream: MediaStream | null = null
  private nodes: { disconnect(): void }[] = []
  private events: WhisperEvents | null = null
  private busy = false
  private queued: Float32Array | null = null
  private sentSeconds = 0
  private vad: SpeechSegmenter | null = null
  /** Nombre del micrófono en uso (después de start). */
  micLabel = ''
  device = ''
  lastMs = 0

  /** Revisa que el servidor tenga la API key de OpenRouter. */
  load(): Promise<string> {
    if (this.ready) return this.ready
    this.ready = fetch('/api/transcribe')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the server responded ${r.status}`))))
      .then((j: { ok?: boolean }) => {
        if (!j.ok) throw new Error('OPENROUTER_API_KEY is missing on the server')
        this.device = 'openrouter'
        return 'openrouter'
      })
      .catch((err) => { this.ready = null; throw err })
    return this.ready
  }

  /**
   * Abre el micrófono y empieza a mandar frases a Whisper. El micrófono entra al MISMO motor de audio
   * que la música (no se abre un segundo motor, que en Windows puede trabar o silenciar la salida).
   */
  async start(events: WhisperEvents): Promise<void> {
    this.events = events
    if (this.stream) return
    await Tone.start().catch(() => {})
    const ctx = Tone.getContext()
    if (ctx.state !== 'running') throw new Error('needs-gesture')
    // Sin cancelación de eco: con audífonos no hace falta, y Windows trata el micrófono con eco
    // cancelado como una "llamada" (puede bajar o alterar el resto del audio).
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    })
    this.micLabel = this.stream.getAudioTracks()[0]?.label || 'Default microphone'
    const raw = ctx.rawContext as unknown as { audioWorklet: { addModule(url: string): Promise<void> } }
    if (!workletLoaded.has(raw)) {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))
      await raw.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      workletLoaded.add(raw)
    }
    const src = ctx.createMediaStreamSource(this.stream)
    // Sin salidas: el micrófono nunca llega a las bocinas.
    const tap = ctx.createAudioWorkletNode('es-mic-tap', { numberOfInputs: 1, numberOfOutputs: 0 })
    src.connect(tap)
    this.nodes = [src, tap]
    const vad = new SpeechSegmenter(
      { sampleRate: SAMPLE_RATE, sensitivity: getSensitivity() },
      (audio) => this.send(audio),
      (on) => { if (on) this.events?.onActivity?.('speech'); else if (!this.busy) this.events?.onActivity?.('idle') },
      (reason, seconds) => this.events?.onDrop?.(reason, seconds),
    )
    this.vad = vad
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      vad.push(e.data)
      this.events?.onLevel?.({ db: vad.lastDb, floorDb: vad.noiseFloorDb, thresholdDb: vad.thresholdDb, speaking: vad.isSpeaking })
    }
  }

  /** Manda una frase a Whisper. Si está ocupado, guarda solo la más reciente (con ruido no se acumulan). */
  private send(audio: Float32Array) {
    if (this.busy) { this.queued = audio; return }
    this.busy = true
    this.sentSeconds = audio.length / SAMPLE_RATE
    this.events?.onActivity?.('processing')
    void this.sendCloud(audio)
  }

  private async sendCloud(audio: Float32Array) {
    const t0 = performance.now()
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: toWavBase64(audio, SAMPLE_RATE) }),
      })
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
      if (!res.ok) throw new Error(j.error ?? `the server responded ${res.status}`)
      this.cloudFailures = 0
      this.onResult(j.text ?? '', performance.now() - t0)
    } catch (err) {
      this.onResult('', performance.now() - t0)
      if (++this.cloudFailures >= 3) this.events?.onFatal?.((err as Error).message)
      console.warn('Whisper (OpenRouter):', err)
    }
  }

  private onResult(text: string, ms: number) {
    this.lastMs = ms
    this.busy = false
    this.events?.onRaw?.(text, { audioSeconds: this.sentSeconds, ms })
    const clean = cleanTranscript(text)
    if (clean) this.events?.onText(clean)
    if (this.queued) {
      const q = this.queued
      this.queued = null
      this.send(q)
    } else {
      this.events?.onActivity?.('idle')
    }
  }

  /** Cambia la sensibilidad al momento (y la guarda para la app). */
  setSensitivity(v: number) {
    saveSensitivity(v)
    this.vad?.setSensitivity(v)
  }

  /** Cierra el micrófono. */
  stop() {
    for (const n of this.nodes) { try { n.disconnect() } catch { /* ya desconectado */ } }
    this.nodes = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.vad = null
    this.queued = null
    this.busy = false
    this.events?.onActivity?.('idle')
  }

  dispose() {
    this.stop()
    this.ready = null
  }
}
