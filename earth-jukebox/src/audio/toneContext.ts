import * as Tone from 'tone'

/**
 * Motor de audio compartido por toda la app (música y micrófono), y su vigilante.
 *
 * - latencyHint 0.1 s: búfer de salida de 100 ms (antes 10 ms). Esta música no necesita respuesta
 *   instantánea; con búferes cortos, cuando la laptop se tarda un poco (decodificar el video, dibujar),
 *   el audio se queda sin datos y suena a "palomitas", y tras muchos cortes Chrome puede dejar la
 *   salida de la pestaña en silencio.
 * - lookAhead 0.15 s: las notas se programan con anticipación, así una pausa breve del hilo
 *   principal no las hace salir tarde.
 * - Vigilante: si la música estaba sonando y la salida se queda en silencio mientras se reproduce,
 *   si el reloj del audio se congela, o si Chrome reporta un error de salida, reinicia la salida
 *   (suspender y reanudar el motor, que vuelve a abrir el dispositivo de audio).
 *
 * configureAudio() debe llamarse antes de crear cualquier sintetizador.
 */

export const audioHealth = {
  /** Veces que el vigilante reinició la salida de audio. */
  recoveries: 0,
  lastReason: '',
}

let configured = false
let expectSound: () => boolean = () => false

/** La app dice cuándo debería oírse algo (video reproduciendo y alguna capa encendida). */
export function setSoundExpected(fn: () => boolean) {
  expectSound = fn
}

export function configureAudio() {
  if (configured) return
  configured = true
  // Tone solo acepta categorías ('playback'…); un número se le pide directo al navegador.
  const ctx = new Tone.Context(new AudioContext({ latencyHint: 0.1 }))
  ctx.lookAhead = 0.15
  Tone.setContext(ctx)
  startWatchdog()
}

function startWatchdog() {
  const ctx = Tone.getContext()
  const raw = ctx.rawContext as unknown as AudioContext
  let analyser: AnalyserNode | null = null
  const buf = new Float32Array(1024)
  let lastTime = -1
  let frozen = 0
  let silent = 0
  let heardAt = 0
  let recovering = false

  const recover = async (reason: string) => {
    if (recovering) return
    recovering = true
    audioHealth.recoveries++
    audioHealth.lastReason = reason
    if (import.meta.env.DEV) console.warn('[audio] reinicio de la salida:', reason)
    try {
      await raw.suspend()
      await raw.resume()
    } catch {
      /* se reintenta en la siguiente revisión */
    }
    frozen = 0
    silent = 0
    recovering = false
  }

  try {
    raw.addEventListener('error', () => void recover('error de la salida de audio'))
  } catch {
    /* navegador sin el evento */
  }

  window.setInterval(() => {
    if (raw.state !== 'running') return
    if (!analyser) {
      try {
        analyser = raw.createAnalyser()
        analyser.fftSize = 1024
        const dest = Tone.getDestination() as unknown as { input: AudioNode }
        dest.input.connect(analyser)
      } catch {
        return
      }
    }
    // ¿Avanza el reloj del audio?
    const t = raw.currentTime
    frozen = lastTime >= 0 && t - lastTime < 0.2 ? frozen + 1 : 0
    lastTime = t
    // ¿Hay sonido?
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    const now = performance.now()
    if (peak > 1e-4) heardAt = now
    const expected = expectSound()
    // Solo cuenta como falla si SÍ se estaba oyendo hace poco y de pronto se calló.
    silent = expected && peak <= 1e-4 && now - heardAt < 30000 ? silent + 1 : 0
    if (frozen >= 2) void recover('el reloj del audio se congeló')
    else if (silent >= 3) void recover('silencio inesperado durante la reproducción')
  }, 1000)
}
