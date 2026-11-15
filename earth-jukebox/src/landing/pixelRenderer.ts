/**
 * Motor de dibujo de fondos de píxeles, optimizado.
 *
 * El componente original dibujaba cada celda por separado (con pixelSize 2 en una pantalla de
 * 1440×900 son ~320,000 círculos por cuadro, cada uno con su propio texto de color y su propia
 * figura). Aquí se obtiene el MISMO aspecto con unas pocas operaciones por cuadro:
 *
 *  1. El video se reduce en la GPU a una imagen de una celda = un píxel (p. ej. 720×450).
 *  2. Los colores se traducen con una tabla precalculada (32,768 entradas, 5 bits por canal):
 *     la paleta se resuelve una sola vez, no en cada píxel de cada cuadro.
 *  3. Esa imagen pequeña se escala sin suavizado al tamaño real (un solo drawImage).
 *  4. Una máscara repetida (patrón de círculos/cuadros/octágonos) convierte los cuadros en figuras.
 *     Cerca del mouse se usa una máscara con figuras más grandes (dos anillos), como el original.
 */

export type ShapeMode = 'circles' | 'squares' | 'octagons' | 'small-circles-squares' | 'random'

/** Tabla de color: índice (r>>3)<<10 | (g>>3)<<5 | (b>>3) → RGBA empaquetado (little-endian). */
export type ColorLut = Uint32Array

const pack = (r: number, g: number, b: number, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

export function buildLut(map: (r: number, g: number, b: number) => [number, number, number, number?] | null): ColorLut {
  const lut = new Uint32Array(32768)
  for (let i = 0; i < 32768; i++) {
    const r = ((i >> 10) & 31) * 8 + 4
    const g = ((i >> 5) & 31) * 8 + 4
    const b = (i & 31) * 8 + 4
    const c = map(r, g, b)
    lut[i] = c ? pack(c[0], c[1], c[2], c[3] ?? 255) : 0
  }
  return lut
}

export function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function paletteLut(palette: string[]): ColorLut {
  const pal = palette.map(hexToRgb)
  return buildLut((r, g, b) => {
    let best = pal[0]
    let bd = Infinity
    for (const p of pal) {
      const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2
      if (d < bd) { bd = d; best = p }
    }
    return best
  })
}
export const fullLut = () => buildLut((r, g, b) => [r, g, b])
export const greyLut = () => buildLut((r, g, b) => {
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  return [y, y, y]
})

function shapeFor(mode: ShapeMode, cx: number, cy: number): 'circle' | 'square' | 'octagon' | 'small-circle' | 'small-square' {
  if (mode === 'circles') return 'circle'
  if (mode === 'squares') return 'square'
  if (mode === 'octagons') return 'octagon'
  if (mode === 'small-circles-squares') return (cx + cy) % 2 === 0 ? 'small-square' : 'small-circle'
  return (['circle', 'square', 'octagon'] as const)[(cx * 17 + cy * 31) % 3] // mismo patrón que el original
}

/** Patrón de máscara: celdas blancas con la figura, escala `s` (0.9 normal; más cerca del mouse). */
function makeMask(ctx: CanvasRenderingContext2D, mode: ShapeMode, cell: number, s: number): CanvasPattern | null {
  const period = mode === 'random' ? 3 : mode === 'small-circles-squares' ? 2 : 1
  const tile = document.createElement('canvas')
  tile.width = tile.height = Math.max(1, Math.round(cell * period))
  const t = tile.getContext('2d')!
  t.fillStyle = '#fff'
  const rad = cell / 2
  for (let cy = 0; cy < period; cy++) {
    for (let cx = 0; cx < period; cx++) {
      const x = cx * cell
      const y = cy * cell
      const shape = shapeFor(mode, cx, cy)
      if (shape === 'circle' || shape === 'small-circle') {
        t.beginPath()
        t.arc(x + rad, y + rad, rad * s * (shape === 'small-circle' ? 0.7 : 1), 0, Math.PI * 2)
        t.fill()
      } else if (shape === 'square' || shape === 'small-square') {
        const size = cell * s * (shape === 'small-square' ? 0.85 : 1)
        t.fillRect(x + (cell - size) / 2, y + (cell - size) / 2, size, size)
      } else {
        t.beginPath()
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + Math.PI / 8
          const vx = x + rad + rad * s * Math.cos(a)
          const vy = y + rad + rad * s * Math.sin(a)
          if (i === 0) t.moveTo(vx, vy)
          else t.lineTo(vx, vy)
        }
        t.closePath()
        t.fill()
      }
    }
  }
  return ctx.createPattern(tile, 'repeat')
}

export interface RendererOptions {
  pixelSize: number
  shape: ShapeMode
  lut: ColorLut
  contrast?: number
  lightness?: number
}

export class PixelRenderer {
  private ctx: CanvasRenderingContext2D
  private small = document.createElement('canvas')
  private sctx: CanvasRenderingContext2D
  private masks: { normal: CanvasPattern | null; near: CanvasPattern | null; nearest: CanvasPattern | null } = { normal: null, near: null, nearest: null }
  private w = 0
  private h = 0
  private dpr = 1
  /** Milisegundos del último dibujo (para medir). */
  lastMs = 0

  private canvas: HTMLCanvasElement
  private opts: RendererOptions

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas
    this.opts = opts
    this.ctx = canvas.getContext('2d')!
    this.sctx = this.small.getContext('2d', { willReadFrequently: true })!
  }

  setOptions(opts: RendererOptions) {
    this.opts = opts
    this.resize(this.w, this.h)
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, Math.floor(w))
    this.h = Math.max(1, Math.floor(h))
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    const ps = this.opts.pixelSize
    this.small.width = Math.ceil(this.w / ps)
    this.small.height = Math.ceil(this.h / ps)
    const cell = ps * this.dpr
    this.masks = {
      normal: makeMask(this.ctx, this.opts.shape, cell, 0.9),
      near: makeMask(this.ctx, this.opts.shape, cell, 1.15),
      nearest: makeMask(this.ctx, this.opts.shape, cell, 1.35),
    }
  }

  /** Dibuja un cuadro del medio (video o imagen). mouse en coordenadas CSS del lienzo, o null. */
  draw(media: CanvasImageSource, mw: number, mh: number, mouse: { x: number; y: number } | null) {
    const t0 = performance.now()
    const { ctx, sctx, small } = this
    const cols = small.width
    const rows = small.height
    const ps = this.opts.pixelSize
    // 1) Reducir en la GPU ("cover": llenar recortando lo que sobre), con contraste/brillo opcionales.
    const mr = mw / mh
    const cr = (cols * ps) / (rows * ps)
    let dw = cols, dh = rows, dx = 0, dy = 0
    if (cr > mr) { dh = cols / mr; dy = (rows - dh) / 2 } else { dw = rows * mr; dx = (cols - dw) / 2 }
    const c = this.opts.contrast ?? 100
    const l = this.opts.lightness ?? 100
    sctx.filter = c !== 100 || l !== 100 ? `contrast(${c}%) brightness(${l}%)` : 'none'
    sctx.imageSmoothingEnabled = true
    sctx.clearRect(0, 0, cols, rows)
    sctx.drawImage(media, dx, dy, dw, dh)
    sctx.filter = 'none'
    // 2) Traducir colores con la tabla.
    const img = sctx.getImageData(0, 0, cols, rows)
    const px = new Uint32Array(img.data.buffer)
    const lut = this.opts.lut
    for (let i = 0; i < px.length; i++) {
      const v = px[i]
      px[i] = (v >>> 24) === 0 ? 0 : lut[((v & 0xf8) << 7) | ((v >> 6) & 0x3e0) | ((v >> 19) & 0x1f)]
    }
    sctx.putImageData(img, 0, 0)
    // 3) Escalar sin suavizado al tamaño real.
    const W = this.canvas.width
    const H = this.canvas.height
    const cell = ps * this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, cols * cell, rows * cell)
    // 4) Máscara de figuras (más grandes cerca del mouse).
    ctx.globalCompositeOperation = 'destination-in'
    const R = 120 * this.dpr
    if (mouse && this.masks.near && this.masks.nearest) {
      const mx = mouse.x * this.dpr
      const my = mouse.y * this.dpr
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.arc(mx, my, R, 0, Math.PI * 2, true)
      ctx.clip('evenodd')
      ctx.fillStyle = this.masks.normal!
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.arc(mx, my, R, 0, Math.PI * 2)
      ctx.arc(mx, my, R / 2, 0, Math.PI * 2, true)
      ctx.clip('evenodd')
      ctx.fillStyle = this.masks.near
      ctx.fillRect(mx - R, my - R, 2 * R, 2 * R)
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.arc(mx, my, R / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = this.masks.nearest
      ctx.fillRect(mx - R, my - R, 2 * R, 2 * R)
      ctx.restore()
    } else if (this.masks.normal) {
      ctx.fillStyle = this.masks.normal
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'source-over'
    this.lastMs = performance.now() - t0
  }
}

type VideoRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (h: number) => void
}

/**
 * Conecta un PixelRenderer a un video o imagen dentro de un contenedor:
 * redibuja solo cuando hay un cuadro nuevo del video o el mouse se mueve, se pausa fuera de pantalla
 * y respeta "reducir movimiento" (un solo cuadro, sin seguir al mouse).
 */
export function mountPixelMedia(
  canvas: HTMLCanvasElement,
  src: string,
  opts: RendererOptions & { interactive?: boolean; startAt?: number },
  onStats?: (ms: number) => void,
): () => void {
  const renderer = new PixelRenderer(canvas, opts)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const interactive = (opts.interactive ?? true) && !reduced
  const isVideo = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(src)
  let video: VideoRVFC | null = null
  let image: HTMLImageElement | null = null
  let ready = false
  let visible = true
  let mouse: { x: number; y: number } | null = null
  let pending = 0
  let vfc = 0

  const draw = () => {
    pending = 0
    if (!ready) return
    if (video) {
      if (video.readyState < 2) return
      renderer.draw(video, video.videoWidth, video.videoHeight, mouse)
    } else if (image) {
      renderer.draw(image, image.naturalWidth, image.naturalHeight, mouse)
    }
    onStats?.(renderer.lastMs)
  }
  const requestDraw = () => {
    if (!pending) pending = requestAnimationFrame(draw)
  }

  const onFrame = () => {
    if (!video) return
    requestDraw()
    if (visible && !reduced) vfc = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame)
  }

  const resize = () => {
    const parent = canvas.parentElement
    renderer.resize(parent?.clientWidth || window.innerWidth, parent?.clientHeight || window.innerHeight)
    requestDraw()
  }

  if (isVideo) {
    video = document.createElement('video') as VideoRVFC
    video.src = src
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadeddata = () => {
      if (opts.startAt) video!.currentTime = opts.startAt
      ready = true
      requestDraw()
      if (visible && !reduced) {
        void video!.play().catch(() => {})
        onFrame()
      }
    }
  } else {
    image = new Image()
    image.src = src
    image.onload = () => {
      ready = true
      requestDraw()
    }
  }

  const onMove = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect()
    const inside = e.clientX > r.left - 120 && e.clientX < r.right + 120 && e.clientY > r.top - 120 && e.clientY < r.bottom + 120
    const next = inside ? { x: e.clientX - r.left, y: e.clientY - r.top } : null
    if (!next && !mouse) return
    mouse = next
    if (!video || video.paused) requestDraw() // el video ya redibuja en cada cuadro
  }
  const onLeave = () => {
    mouse = null
    requestDraw()
  }

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (!video) return
    if (visible && ready && !reduced) {
      void video.play().catch(() => {})
      onFrame()
    } else {
      video.pause()
    }
  })
  io.observe(canvas)
  resize()
  window.addEventListener('resize', resize)
  if (interactive) {
    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
  }

  return () => {
    cancelAnimationFrame(pending)
    if (video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfc)
    else cancelAnimationFrame(vfc)
    io.disconnect()
    window.removeEventListener('resize', resize)
    window.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseleave', onLeave)
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }
}
