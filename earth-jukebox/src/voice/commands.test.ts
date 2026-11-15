import { describe, expect, it } from 'vitest'
import { afterWakeWord, lastWords, parseCommand } from './commands'
import { forSpeech, isEcho } from './speak'
import { VOCAB } from './vocab'
import source from './commands.ts?raw'

const cases: [string, unknown][] = [
  ['Start the simulator', { type: 'play' }],
  ['play', { type: 'play' }],
  ['Play the symphony', { type: 'play' }],
  ["let's go", { type: 'play' }],
  ['Pause the simulator', { type: 'pause' }],
  ['stop', { type: 'pause' }],
  ['hold on', { type: 'pause' }],
  ['Resume the simulation', { type: 'resume' }],
  ['continue', { type: 'resume' }],
  ['keep going', { type: 'resume' }],
  ['Take me to the fire simulation', { type: 'goto', target: 'incendio' }],
  ['open the Dixie fire', { type: 'goto', target: 'incendio' }],
  ['go to the wildfire', { type: 'goto', target: 'incendio' }],
  ['Take me to the storms', { type: 'goto', target: 'rayos' }],
  ['show me the lightning', { type: 'goto', target: 'rayos' }],
  ['take me home', { type: 'goto', target: 'inicio' }],
  ['go back to the home page', { type: 'goto', target: 'inicio' }],
  ['restart', { type: 'restart' }],
  ['start over', { type: 'restart' }],
  ['from the beginning', { type: 'restart' }],
  ['skip 20 seconds', { type: 'seek', seconds: 20 }],
  ['fast forward', { type: 'seek', seconds: 10 }],
  ['go back ten seconds', { type: 'seek', seconds: -10 }],
  ['skip back 30 seconds', { type: 'seek', seconds: -30 }],
  ['rewind', { type: 'seek', seconds: -10 }],
  ['turn off the thunder', { type: 'layer', layer: 'truenos', on: false }],
  ['turn on the lightning', { type: 'layer', layer: 'rayos', on: true }],
  ['mute the fire', { type: 'layer', layer: 'fuego', on: false }],
  ['turn off the fire front', { type: 'layer', layer: 'frente', on: false }],
  ['enable the burned area', { type: 'layer', layer: 'quemada', on: true }],
  ['volume up', { type: 'volume', dir: 1 }],
  ['quieter', { type: 'volume', dir: -1 }],
  ['slower', { type: 'speed', value: 0.5 }],
  ['normal speed', { type: 'speed', value: 1 }],
  ['describe this moment', { type: 'describe' }],
  ["what's happening?", { type: 'describe' }],
  ['where are the storms?', { type: 'describe' }],
  ['What can I say?', { type: 'help' }],
  ['start the tour', { type: 'tour', dir: 1 }],
  ['next', { type: 'tour', dir: 1 }],
  ['previous', { type: 'tour', dir: -1 }],
  ['stop listening', { type: 'stopListening' }],
]

describe('parseCommand', () => {
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => expect(parseCommand(text)).toEqual(expected))
  }
  it('ignora frases que no son comandos', () => {
    for (const t of ['hello how are you', 'thank you', 'that is so cool', 'I really like it', 'this is amazing', '']) {
      expect(parseCommand(t)).toBeNull()
    }
  })
})

describe('entiende variantes y errores de una letra', () => {
  const fuzzy: [string, unknown][] = [
    ['pausing', { type: 'pause' }],
    ['paused the simulation', { type: 'pause' }],
    ['resumes', { type: 'resume' }],
    ['restarting', { type: 'restart' }],
    ['skips 10 seconds', { type: 'seek', seconds: 10 }],
    ['take me to the stroms', { type: 'goto', target: 'rayos' }],
    ['take me to the wildfir', { type: 'goto', target: 'incendio' }],
    ['turn off the thundr', { type: 'layer', layer: 'truenos', on: false }],
    ['describes this moment', { type: 'describe' }],
  ]
  for (const [text, expected] of fuzzy) {
    it(`"${text}"`, () => expect(parseCommand(text)).toEqual(expected))
  }
})

describe('ruido', () => {
  it('se queda con lo que va después de "Symphony"', () => {
    expect(afterWakeWord('so then what happened Symphony pause')).toBe('pause')
    expect(afterWakeWord('symphonie skip 20 seconds')).toBe('skip 20 seconds')
    expect(afterWakeWord('nobody said the word')).toBeNull()
  })
  it('el comando al final de una plática larga se encuentra', () => {
    const merged = 'and then I told John to go get the food because it was getting late pause the simulator'
    expect(parseCommand(lastWords(merged))).toEqual({ type: 'pause' })
  })
  it('modo ruido y modo normal', () => {
    expect(parseCommand('noise mode')).toEqual({ type: 'noiseMode', on: true })
    expect(parseCommand("it's too noisy")).toEqual({ type: 'noiseMode', on: true })
    expect(parseCommand('normal mode')).toEqual({ type: 'noiseMode', on: false })
    expect(parseCommand('turn off noise mode')).toEqual({ type: 'noiseMode', on: false })
  })
})

describe('forSpeech', () => {
  it('escribe completas las fechas y los grados', () => {
    expect(forSpeech('Aug 4, 2021, day 21')).toBe('August 4, 2021, day 21')
    expect(forSpeech('centered near 7° S.')).toBe('centered near 7 degrees south.')
    expect(forSpeech('12° N')).toBe('12 degrees north')
  })
})

describe('isEcho', () => {
  it('sin voz de la app sonando, nada es eco', () => {
    expect(isEcho('pause')).toBe(false)
  })
})

describe('vocabulario', () => {
  it('incluye todas las palabras que usa el intérprete', () => {
    const body = source
      .slice(source.indexOf('const LAYER_WORDS'), source.indexOf('/** ¿Es la palabra clave'))
      .replace(/^\s*\/\/.*$/gm, '')
    const words = new Set<string>()
    for (const m of body.matchAll(/\/((?:\\.|[^/\n])+)\//g)) {
      for (const w of m[1].replaceAll('\\b', '  ').replaceAll('\\w', '  ').match(/[a-zñ]{3,}/g) ?? []) words.add(w)
    }
    const missing = [...words].filter((w) => !VOCAB.includes(w))
    expect(missing).toEqual([])
  })
})
