import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL, status, transcribe } from '../../api/transcribe.ts'

afterEach(() => vi.unstubAllGlobals())

describe('/api/transcribe', () => {
  it('avisa si no hay key', async () => {
    expect(status(undefined).json.ok).toBe(false)
    expect((await transcribe({ audio: 'AAAA' }, undefined)).status).toBe(503)
  })
  it('rechaza cuerpos inválidos o audio demasiado largo', async () => {
    expect((await transcribe(null, 'k')).status).toBe(400)
    expect((await transcribe({ audio: 'x'.repeat(400_000) }, 'k')).status).toBe(413)
  })
  it('manda el audio a Whisper large-v3 en inglés y devuelve el texto', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: ' Pause the simulator. ' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await transcribe({ audio: 'UklGRg==' }, 'sk-test')
    expect(r).toEqual({ status: 200, json: { text: 'Pause the simulator.' } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toEqual({ model: MODEL, input_audio: { data: 'UklGRg==', format: 'wav' }, language: 'en' })
  })
  it('reporta los errores de OpenRouter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Insufficient credits', { status: 402 })))
    const r = await transcribe({ audio: 'UklGRg==' }, 'sk-test')
    expect(r.status).toBe(502)
    expect(r.json.error).toContain('402')
  })
})
