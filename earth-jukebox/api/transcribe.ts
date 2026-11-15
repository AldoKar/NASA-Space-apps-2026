/**
 * /api/transcribe — Función de servidor (Vercel) que transcribe una frase con Whisper large-v3 de OpenRouter.
 *
 * La API key vive solo aquí, en la variable de entorno OPENROUTER_API_KEY (Vercel → Settings →
 * Environment Variables; en local, en .env.local). La página nunca la ve: solo manda el audio de cada
 * frase (WAV de pocos segundos, en base64) y recibe el texto.
 *
 *   GET  → { ok, model }   ¿hay key configurada?
 *   POST { audio } → { text }
 */

export const MODEL = 'openai/whisper-large-v3'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
/** ~6 s de audio a 16 kHz en WAV de 16 bits, en base64. Más grande no es un comando. */
const MAX_BASE64 = 300_000

export interface ApiResult {
  status: number
  json: { text?: string; error?: string; ok?: boolean; model?: string }
}

export function status(apiKey: string | undefined): ApiResult {
  return { status: 200, json: { ok: !!apiKey, model: MODEL } }
}

export async function transcribe(body: unknown, apiKey: string | undefined): Promise<ApiResult> {
  if (!apiKey) return { status: 503, json: { error: 'OPENROUTER_API_KEY is missing on the server' } }
  const audio = (body as { audio?: unknown } | null)?.audio
  if (typeof audio !== 'string' || !audio) return { status: 400, json: { error: 'Missing audio' } }
  if (audio.length > MAX_BASE64) return { status: 413, json: { error: 'Audio too long' } }
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'The Earth Symphony',
      },
      body: JSON.stringify({ model: MODEL, input_audio: { data: audio, format: 'wav' }, language: 'en' }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      return { status: 502, json: { error: `OpenRouter responded ${res.status}: ${detail}` } }
    }
    const data = (await res.json()) as { text?: string }
    return { status: 200, json: { text: (data.text ?? '').trim() } }
  } catch (err) {
    return { status: 502, json: { error: `Could not reach OpenRouter: ${(err as Error).message}` } }
  }
}

const key = () => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OPENROUTER_API_KEY

export function GET(): Response {
  const r = status(key())
  return Response.json(r.json, { status: r.status })
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const r = await transcribe(body, key())
  return Response.json(r.json, { status: r.status })
}
