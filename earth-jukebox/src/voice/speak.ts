/**
 * Voz del navegador (speechSynthesis): responde en inglés a los comandos.
 * Elige la mejor voz disponible: inglés de EE. UU. primero, y las voces "naturales"
 * (Edge: "Microsoft Aria/Jenny Online (Natural)", Chrome: "Google US English").
 */

let voice: SpeechSynthesisVoice | null = null
let speakingUntil = 0
let lastSpoken = ''
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

function score(v: SpeechSynthesisVoice): number {
  const lang = v.lang.toLowerCase().replace('_', '-')
  if (!lang.startsWith('en')) return -1
  let s = 1
  if (lang === 'en-us') s += 40
  else if (lang === 'en-gb') s += 30
  else if (lang === 'en-au' || lang === 'en-ca') s += 20
  if (/natural|online|neural/i.test(v.name)) s += 25
  if (/google/i.test(v.name)) s += 15
  if (/aria|jenny|guy|samantha|alex/i.test(v.name)) s += 5
  return s
}

function pickVoice() {
  if (!supported) return
  const best = speechSynthesis
    .getVoices()
    .map((v) => [score(v), v] as const)
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])[0]
  voice = best ? best[1] : null
}
if (supported) {
  pickVoice()
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice)
}

const MONTHS: Record<string, string> = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
}

/** Escribe completo lo que la voz leería mal: "Aug 4, 2021" → "August 4, 2021", "7° S" → "7 degrees south". */
export function forSpeech(text: string): string {
  return text
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? (\d{1,2}), (\d{4})\b/g, (_, m, d, y) => `${MONTHS[m.toLowerCase()]} ${d}, ${y}`)
    .replace(/(\d+(?:[.,]\d+)?)\s*°\s*N\b/g, '$1 degrees north')
    .replace(/(\d+(?:[.,]\d+)?)\s*°\s*S\b/g, '$1 degrees south')
    .replace(/(\d+(?:[.,]\d+)?)\s*°/g, '$1 degrees')
    .replace(/\s·\s/g, ', ')
}

/**
 * Dice un texto. Interrumpe lo que se estuviera diciendo. Las frases se dicen por separado
 * porque Chrome corta las frases muy largas a los ~15 segundos.
 */
export function speak(text: string) {
  if (!supported || !text) return
  speechSynthesis.cancel()
  const spoken = forSpeech(text)
  lastSpoken = spoken
  const parts = spoken.match(/[^.!?]+[.!?]*/g) ?? [spoken]
  for (const part of parts) {
    const u = new SpeechSynthesisUtterance(part.trim())
    u.lang = voice?.lang ?? 'en-US'
    if (voice) u.voice = voice
    u.rate = 1.05
    u.onend = () => { speakingUntil = performance.now() + 700 }
    speechSynthesis.speak(u)
  }
  speakingUntil = Number.POSITIVE_INFINITY
}

export function stopSpeaking() {
  if (supported) speechSynthesis.cancel()
  speakingUntil = performance.now() + 300
}

/** ¿La app está hablando (o acaba de hablar)? Mientras, el micrófono ignora lo que oye: es su propia voz. */
export function isSpeaking(): boolean {
  if (!supported) return false
  if (speechSynthesis.speaking || speechSynthesis.pending) return true
  return performance.now() < speakingUntil && speakingUntil !== Number.POSITIVE_INFINITY
}

export const voiceName = () => voice?.name ?? null

const words = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(Boolean)

/**
 * ¿Lo que oyó el micrófono es la propia voz de la app (con bocinas)? Solo si está hablando y casi todas
 * las palabras oídas están en lo que dice. Si no, es la persona hablando encima: se atiende.
 */
export function isEcho(transcript: string): boolean {
  if (!isSpeaking()) return false
  const heard = words(transcript)
  if (!heard.length) return true
  const said = new Set(words(lastSpoken))
  return heard.filter((w) => said.has(w)).length / heard.length >= 0.6
}
