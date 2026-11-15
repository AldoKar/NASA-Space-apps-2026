import { useEffect, useRef } from 'react'

/**
 * Lo que necesita el bucle de análisis para una pista: tamaño de análisis, cómo procesar un
 * cuadro (detector + motor de sonido) y cómo reiniciarse al saltar en el video.
 */
export interface FrameProcessor<T> {
  width: number
  height: number
  process(rgba: Uint8ClampedArray, mediaTime: number, dt: number, paused: boolean): T
  reset(): void
  noteError(e: unknown): void
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** Estadísticas del bucle para la sección de diagnóstico (?debug). */
export const loopStats = { frameErrors: 0, restarts: 0, analysisMs: 0 }

/**
 * Bucle principal: por cada cuadro nuevo del video,
 *   1) lo dibuja reducido en un canvas oculto,
 *   2) lee los píxeles y los convierte en números (detector),
 *   3) pasa esos números al motor de sonido,
 *   4) avisa a la interfaz (onTick) para dibujar y actualizar indicadores.
 */
export function useAnalysisLoop<T>(
  video: HTMLVideoElement | null,
  processor: FrameProcessor<T> | null,
  onTick: (t: T) => void,
) {
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (!video || !processor) return
    const v = video as VideoWithRVFC
    const W = processor.width
    const H = processor.height
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    processor.reset()
    let handle = 0
    let stopped = false
    let lastWall = performance.now()
    let lastMediaTime = -1
    let lastFrameAt = performance.now()

    const process = (mediaTime: number) => {
      const wall = performance.now()
      const dt = Math.min((wall - lastWall) / 1000, 0.25)
      lastWall = wall
      lastFrameAt = wall
      if (mediaTime === lastMediaTime) return
      lastMediaTime = mediaTime
      const t0 = performance.now()
      ctx.drawImage(v, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)
      const out = processor.process(data, mediaTime, dt, v.paused)
      loopStats.analysisMs = loopStats.analysisMs * 0.9 + (performance.now() - t0) * 0.1
      onTickRef.current(out)
    }

    // Un cuadro que falla se cuenta y se ignora: nunca debe detener el bucle.
    const safeProcess = (mediaTime: number) => {
      try {
        process(mediaTime)
      } catch (e) {
        loopStats.frameErrors++
        processor.noteError(e) // se cuenta una sola vez, en el motor
      }
    }

    const cancel = () => {
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }

    const schedule = () => {
      if (stopped) return
      if (v.requestVideoFrameCallback) {
        handle = v.requestVideoFrameCallback((_now, meta) => {
          try {
            safeProcess(meta.mediaTime)
          } finally {
            schedule() // siempre se vuelve a armar, pase lo que pase
          }
        })
      } else {
        handle = requestAnimationFrame(() => {
          try {
            if (v.readyState >= 2) safeProcess(v.currentTime)
          } finally {
            schedule()
          }
        })
      }
    }

    // Perro guardián: si el video se reproduce, la página está visible y pasan más de 1.5 s
    // sin cuadros analizados, se reinicia el bucle.
    const watchdog = window.setInterval(() => {
      if (stopped || v.paused || v.ended || v.seeking || v.readyState < 3 || document.visibilityState !== 'visible') return
      if (performance.now() - lastFrameAt > 1500) {
        loopStats.restarts++
        lastFrameAt = performance.now()
        processor.reset()
        cancel()
        schedule()
      }
    }, 500)

    const onSeeking = () => processor.reset()
    const onSeeked = () => {
      // Analiza el cuadro al que se saltó aunque el video esté en pausa.
      if (v.readyState >= 2) safeProcess(v.currentTime)
    }
    const onPlay = () => {
      lastFrameAt = performance.now()
    }
    v.addEventListener('seeking', onSeeking)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('play', onPlay)
    schedule()

    return () => {
      stopped = true
      window.clearInterval(watchdog)
      v.removeEventListener('seeking', onSeeking)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('play', onPlay)
      cancel()
    }
  }, [video, processor])
}
