import { useMemo } from 'react'
import { FIRE_H, FIRE_W, FireDetector, type FireFeatures } from './fireDetector'
import type { FireEngine, FireTick } from '../audio/fireEngine'
import { useAnalysisLoop, type FrameProcessor } from './useAnalysisLoop'

export interface FireLoopTick extends FireTick {
  features: FireFeatures
  videoTime: number
}

/** Procesador de la pista del incendio: detector del incendio + motor del incendio. */
export function fireProcessor(engine: FireEngine): FrameProcessor<FireLoopTick> {
  const detector = new FireDetector()
  return {
    width: FIRE_W,
    height: FIRE_H,
    process(rgba, mediaTime, dt, paused) {
      const features = detector.analyze(rgba, mediaTime)
      const out = paused
        ? { marks: [], chord: '', phase: 'calma' as const, intensity: 0 }
        : engine.update(features, dt)
      return { features, ...out, videoTime: mediaTime }
    },
    reset: () => detector.reset(),
    noteError: (e) => engine.noteError(e),
  }
}

export function useFireLoop(
  video: HTMLVideoElement | null,
  engine: FireEngine,
  onTick: (t: FireLoopTick) => void,
  enabled = true,
) {
  const processor = useMemo(() => (enabled ? fireProcessor(engine) : null), [engine, enabled])
  useAnalysisLoop(video, processor, onTick)
}
