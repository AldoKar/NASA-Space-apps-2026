import { useMemo } from 'react'
import { ANALYSIS_H, ANALYSIS_W, LightningDetector, type FrameFeatures, type Strike } from './detector'
import type { PlayedStrike, StormEngine } from '../audio/stormEngine'
import { useAnalysisLoop, type FrameProcessor } from './useAnalysisLoop'

export { loopStats } from './useAnalysisLoop'

export interface LoopTick {
  features: FrameFeatures
  played: PlayedStrike[]
  thunder: Strike | null
  chord: string
  /** Balance izquierda/derecha de los rayos nuevos (-1..1), null si no hubo. */
  balance: number | null
  videoTime: number
}

/** Procesador de la pista de rayos: detector de rayos + motor de tormentas. */
export function lightningProcessor(engine: StormEngine): FrameProcessor<LoopTick> {
  const detector = new LightningDetector()
  return {
    width: ANALYSIS_W,
    height: ANALYSIS_H,
    process(rgba, mediaTime, dt, paused) {
      const features = detector.analyze(rgba, mediaTime)
      const out = paused ? { played: [], thunder: null, chord: '', balance: null } : engine.update(features, dt)
      return { features, ...out, videoTime: mediaTime }
    },
    reset: () => detector.reset(),
    noteError: (e) => engine.noteError(e),
  }
}

/** Bucle de la pista de rayos (ver useAnalysisLoop). */
export function useLightningLoop(
  video: HTMLVideoElement | null,
  engine: StormEngine,
  onTick: (t: LoopTick) => void,
  enabled = true,
) {
  const processor = useMemo(() => (enabled ? lightningProcessor(engine) : null), [engine, enabled])
  useAnalysisLoop(video, processor, onTick)
}
