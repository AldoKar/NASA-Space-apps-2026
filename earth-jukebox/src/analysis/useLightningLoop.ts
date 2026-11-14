import { useEffect, useRef } from 'react'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector, type FrameFeatures, type Strike } from './detector'
import type { PlayedStrike, StormEngine } from '../audio/stormEngine'

export interface LoopTick {
  features: FrameFeatures
  played: PlayedStrike[]
  thunder: Strike | null
  chord: string
  videoTime: number
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Bucle principal: por cada cuadro nuevo del video,
 *   1) lo dibuja reducido en un canvas oculto,
 *   2) lee los píxeles y los convierte en números (detector),
 *   3) pasa esos números al motor de sonido,
 *   4) avisa a la interfaz (onTick) para dibujar y actualizar indicadores.
 */
export function useLightningLoop(
  video: HTMLVideoElement | null,
  engine: StormEngine,
  onTick: (t: LoopTick) => void,
) {
  const onTickRef = useRef(onTick)
  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (!video) return
    const v = video as VideoWithRVFC
    const canvas = document.createElement('canvas')
    canvas.width = ANALYSIS_W
    canvas.height = ANALYSIS_H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const detector = new LightningDetector()
    let handle = 0
    let stopped = false
    let lastWall = performance.now()
    let lastMediaTime = -1

    const process = (mediaTime: number) => {
      const wall = performance.now()
      const dt = Math.min((wall - lastWall) / 1000, 0.25)
      lastWall = wall
      if (mediaTime === lastMediaTime) return
      lastMediaTime = mediaTime
      ctx.drawImage(v, 0, 0, ANALYSIS_W, ANALYSIS_H)
      const { data } = ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H)
      const features = detector.analyze(data, mediaTime)
      const out = v.paused
        ? { played: [], thunder: null, chord: '' }
        : engine.update(features, dt)
      onTickRef.current({ features, ...out, videoTime: mediaTime })
    }

    const schedule = () => {
      if (stopped) return
      if (v.requestVideoFrameCallback) {
        handle = v.requestVideoFrameCallback((_now, meta) => {
          process(meta.mediaTime)
          schedule()
        })
      } else {
        handle = requestAnimationFrame(() => {
          if (v.readyState >= 2) process(v.currentTime)
          schedule()
        })
      }
    }

    const onSeeking = () => detector.reset()
    const onSeeked = () => {
      // Analiza el cuadro al que se saltó aunque el video esté en pausa.
      if (v.readyState >= 2) process(v.currentTime)
    }
    v.addEventListener('seeking', onSeeking)
    v.addEventListener('seeked', onSeeked)
    schedule()

    return () => {
      stopped = true
      v.removeEventListener('seeking', onSeeking)
      v.removeEventListener('seeked', onSeeked)
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [video, engine])
}
