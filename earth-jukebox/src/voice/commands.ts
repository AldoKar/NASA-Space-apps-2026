import { VOCAB } from './vocab'

/**
 * Intérprete de comandos de voz (en inglés). Convierte una frase reconocida en una acción.
 * Acepta varias formas de decir lo mismo ("pause", "stop", "hold on"…) y no depende de mayúsculas,
 * acentos ni signos de puntuación. Antes de interpretar, corrige las palabras que el reconocedor
 * escribió un poco distinto (otra conjugación o una letra de diferencia).
 *
 * Los nombres internos de capas y destinos siguen en español (son claves del código, no textos).
 */

export type LayerName = 'rayos' | 'truenos' | 'estaciones' | 'fuego' | 'frente' | 'quemada'
export type GotoTarget = 'incendio' | 'rayos' | 'inicio'

export type Command =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'seek'; seconds: number }
  | { type: 'goto'; target: GotoTarget }
  | { type: 'tour'; dir: 1 | -1 }
  | { type: 'volume'; dir: 1 | -1 }
  | { type: 'speed'; value: 0.5 | 1 }
  | { type: 'layer'; layer: LayerName; on: boolean }
  | { type: 'describe' }
  | { type: 'help' }
  | { type: 'stopListening' }
  | { type: 'noiseMode'; on: boolean }

/** Minúsculas, sin acentos ni puntuación, espacios simples. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const VOCAB_SET = new Set(VOCAB)

/** Distancia de edición (letras a cambiar, agregar o quitar), con tope para no gastar de más. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

const ENDINGS = ['ing', 'ed', 'es', 'er', 'ly', 's', 'e']
/** Raíz aproximada de una palabra: "pausing", "paused" y "pause" comparten "paus". */
function stem(w: string): string {
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length)
  return w
}
const VOCAB_STEMS = VOCAB.map((v) => [v, stem(v)] as const)

/**
 * Cambia cada palabra desconocida por la palabra del vocabulario más parecida, si se parece lo
 * suficiente: misma raíz (otra conjugación) o una letra de diferencia (dos en palabras largas).
 */
export function correct(normalized: string): string {
  return normalized
    .split(' ')
    .map((w) => {
      if (w.length < 4 || /\d/.test(w) || VOCAB_SET.has(w)) return w
      const st = stem(w)
      const max = w.length <= 5 ? 1 : 2
      let best = w
      let bestD = max + 1
      for (const [v, vs] of VOCAB_STEMS) {
        if (st.length >= 3 && vs === st) return v
        const d = distance(w, v, max)
        if (d < bestD) { bestD = d; best = v }
      }
      return best
    })
    .join(' ')
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, minute: 60,
}

function secondsIn(t: string): number {
  const digits = t.match(/\b(\d{1,3})\b/)
  if (digits) return Number(digits[1])
  for (const [w, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) return n
  }
  return 10
}

const has = (t: string, re: RegExp) => re.test(t)
const DESCRIBE = /\b(describe|description|whats happening|what is happening|whats going on|what is going on|where are|what am i hearing|what do i hear|what date|which day|what day|status|whats the date|what is this)\b/

const LAYER_WORDS: [RegExp, LayerName][] = [
  [/\b(thunder|thunders|rumble)\b/, 'truenos'],
  [/\b(seasons?|chords?)\b/, 'estaciones'],
  [/\b(burned area|burnt area|burned|burnt|burn area|area)\b/, 'quemada'],
  [/\b(fire front|front|fronts)\b/, 'frente'],
  [/\b(fire|fires|crackle|crackles|crackling|active fire)\b/, 'fuego'],
  [/\b(lightning|strikes?|bolts?|flash|flashes|sparkles?)\b/, 'rayos'],
]
const OFF_VERB = /\b(turn off|switch off|turn the \w+ off|mute|disable|remove|hide|silence|without|kill|stop|no more)\b/
const ON_VERB = /\b(turn on|switch on|turn the \w+ on|unmute|enable|bring back|add|activate)\b/
const NAV_VERB = /\b(take me|take us|bring me|go|go to|lets go|open|show me|switch to|change to|move to|i want|back to|navigate)\b/

export function parseCommand(raw: string): Command | null {
  const t = correct(normalize(raw))
  if (!t) return null

  // Control de la propia voz y ayuda
  if (has(t, /\b(stop listening|turn off the microphone|turn off microphone|mute the microphone|disable voice|turn off voice|stop voice)\b/)) return { type: 'stopListening' }
  // Modo ruido: solo obedece lo que se dice después de la palabra "Symphony"
  if (has(t, /\b(normal mode|quiet mode|disable noise mode|turn off noise mode|exit noise mode|leave noise mode|no noise mode)\b/)) return { type: 'noiseMode', on: false }
  if (has(t, /\b(noise mode|noisy mode|its noisy|too noisy|very noisy|lots of noise|enable noise mode|turn on noise mode)\b/)) return { type: 'noiseMode', on: true }
  if (has(t, /\b(what can i say|what do i say|help|help me|commands|what can i do|instructions|options)\b/)) return { type: 'help' }

  // Capas: verbo de apagar/prender + nombre de capa (antes que navegar: "turn off the lightning")
  const off = has(t, OFF_VERB)
  const on = has(t, ON_VERB)
  if (off || on) {
    for (const [re, layer] of LAYER_WORDS) {
      if (re.test(t) && !(layer === 'fuego' && has(t, /\b(wildfire|dixie)\b/))) return { type: 'layer', layer, on: !off }
    }
  }

  // Preguntas ("where are the storms?"): describir, no navegar.
  if (has(t, /^(where|what|whats|which|how|tell me)\b/) && has(t, DESCRIBE)) return { type: 'describe' }

  // Navegación
  if (has(t, /\b(home|home page|main page|start page|landing|main menu)\b/)) return { type: 'goto', target: 'inicio' }
  if (has(t, /\b(wildfire|wildfires|dixie|california)\b/) || (has(t, /\b(fire|fires|blaze)\b/) && has(t, NAV_VERB))) {
    return { type: 'goto', target: 'incendio' }
  }
  if (has(t, /\b(storms?|thunderstorms?|planet)\b/) || (has(t, /\b(lightning|strikes?)\b/) && has(t, NAV_VERB))) {
    return { type: 'goto', target: 'rayos' }
  }

  // Recorrido de la página de inicio
  if (has(t, /\btour\b/) || has(t, /^(next|next section|go down|down|scroll down)$/)) return { type: 'tour', dir: 1 }
  if (has(t, /^(previous|previous section|back|go up|up|scroll up)$/)) return { type: 'tour', dir: -1 }

  // Reproducción
  if (has(t, /\b(restart|start over|from the beginning|from the start|start again|play again|from the top|beginning)\b/)) {
    return { type: 'restart' }
  }
  if (has(t, /\b(rewind|go back|back up|jump back|skip back|backwards?|back)\b/)) return { type: 'seek', seconds: -secondsIn(t) }
  if (has(t, /\b(skip|skip ahead|forward|fast forward|advance|jump ahead|go ahead|move ahead|ahead)\b/)) return { type: 'seek', seconds: secondsIn(t) }
  if (has(t, /\b(resume|continue|keep going|unpause|carry on|go on|keep playing)\b/)) return { type: 'resume' }
  if (has(t, /\b(pause|stop|wait|hold on|hold|freeze|halt|be quiet|shut up|silence)\b/)) return { type: 'pause' }

  // Volumen y velocidad
  if (has(t, /\b(turn it up|turn up|volume up|louder|raise the volume|raise volume|increase the volume|increase volume|more volume|crank it up)\b/)) return { type: 'volume', dir: 1 }
  if (has(t, /\b(turn it down|turn down|volume down|quieter|softer|lower the volume|lower volume|decrease the volume|decrease volume|less volume)\b/)) return { type: 'volume', dir: -1 }
  if (has(t, /\b(slower|slow down|slow|half speed)\b/)) return { type: 'speed', value: 0.5 }
  if (has(t, /\b(normal speed|regular speed|full speed|faster|speed up|normal)\b/)) return { type: 'speed', value: 1 }

  if (has(t, /\b(play|start|begin|listen|launch|lets go|hit play|lets start)\b/)) return { type: 'play' }

  // Descripción
  if (has(t, DESCRIBE)) {
    return { type: 'describe' }
  }
  return null
}

/** ¿Es la palabra clave "Symphony"? (también como la escribe el reconocedor: "symphonie", "simphony"…) */
export function isWakeWord(word: string): boolean {
  const w = normalize(word)
  return /^(symph|simph|symf|simf|sinfon|sinphon)/.test(w) || distance(w, 'symphony', 2) <= 2
}

/**
 * Lo que va después de la última vez que se dijo "Sinfonía", o null si no se dijo.
 * "blah blah Symphony pause" → "pause".
 */
export function afterWakeWord(text: string): string | null {
  const words = normalize(text).split(' ')
  for (let i = words.length - 1; i >= 0; i--) {
    if (isWakeWord(words[i])) return words.slice(i + 1).join(' ')
  }
  return null
}

/** Las últimas palabras de una frase: el comando suele estar al final de lo que se oyó. */
export function lastWords(text: string, n = 8): string {
  const words = normalize(text).split(' ')
  return words.slice(-n).join(' ')
}

/** Texto de ayuda hablado, según la página. */
export const HELP_APP =
  'You can say: play, pause, resume, restart, skip 10 seconds or go back 10 seconds. ' +
  'Take me to the fire, take me to the storms, or take me home. ' +
  'Volume up or volume down, slower or normal speed. Turn a layer on or off, for example: turn off the thunder. ' +
  'Describe this moment. And stop listening, to turn off the microphone. ' +
  'If it is very noisy, say: noise mode, and then say Symphony before each command.'

export const HELP_LANDING =
  'You can say: start the tour, next or previous to move around the page. ' +
  'Take me to the storms or take me to the fire to open a simulation, or play to start with the storms. ' +
  'And stop listening, to turn off the microphone. ' +
  'If it is very noisy, say: noise mode, and then say Symphony before each command.'
