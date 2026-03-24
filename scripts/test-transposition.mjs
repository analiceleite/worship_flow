#!/usr/bin/env node
/**
 * Script para testar a transposição de acordes com o novo regex
 */

const NOTE_INDEX = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11,
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const parseToneRoot = (tone) => {
  const m = tone.trim().match(/^([A-G](?:#|b)?)/)
  return m ? m[1] : null
}

const transposeRoot = (root, semitones) => {
  const idx = NOTE_INDEX[root]
  if (idx == null) return root
  const next = (idx + semitones + 120) % 12
  const prefersFlat = root.includes('b')
  return prefersFlat ? NOTES_FLAT[next] : NOTES_SHARP[next]
}

const transposeChordSymbol = (symbol, semitones) => {
  const [main, bass] = symbol.split('/')

  const transposePart = (part) => {
    const m = part.match(/^([A-G](?:#|b)?)(.*)$/)
    if (!m) return part
    return `${transposeRoot(m[1], semitones)}${m[2]}`
  }

  const nextMain = transposePart(main)
  if (!bass) return nextMain
  return `${nextMain}/${transposePart(bass)}`
}

const transposeCifra = (lines, fromTone, toTone) => {
  const fromRoot = parseToneRoot(fromTone)
  const toRoot = parseToneRoot(toTone)
  if (!fromRoot || !toRoot) return lines
  if (fromRoot === toRoot) return lines

  const fromIdx = NOTE_INDEX[fromRoot]
  const toIdx = NOTE_INDEX[toRoot]
  if (fromIdx == null || toIdx == null) return lines

  const semitones = toIdx - fromIdx
  const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

  return lines.map(line =>
    line.replace(chordRe, (token) => transposeChordSymbol(token, semitones))
  )
}

// Testes
console.log('=== TESTE DE TRANSPOSIÇÃO ===\n')

const testCases = [
  {
    from: 'C',
    to: 'B',
    input: ['C   F   G', 'C   F   C'],
    expected: ['B   E   F#', 'B   E   B'],
    desc: 'Transpor de C para B (subir 11 semitom / descer 1 semitom)',
  },
  {
    from: 'A#',
    to: 'B',
    input: ['A# D# E', 'A# D# A#'],
    expected: ['B E F#', 'B E B'],
    desc: 'Transpor de A# para B (subir 1 semitom)',
  },
  {
    from: 'G',
    to: 'C',
    input: ['G   C   D', 'G   Em  Am'],
    expected: ['C   F   G', 'C   Gm  Dm'],
    desc: 'Transpor de G para C (subir 5 semitom)',
  },
  {
    from: 'C',
    to: 'D',
    input: ['C   Cmaj7 C7 Cm', 'F   F#m9 G'],
    expected: ['D   Dmaj7 D7 Dm', 'G   G#m9 A'],
    desc: 'Transpor de C para D com acordes complexos',
  },
  {
    from: 'C',
    to: 'A#',
    input: ['C/E F G', 'C   F9  Gadd9'],
    expected: ['A#/D Eb F#', 'A#  Eb  F#add9'],
    desc: 'Transpor de C para A# com inversões e extensões',
  },
]

let passed = 0
let failed = 0

testCases.forEach(({ from, to, input, expected, desc }) => {
  const result = transposeCifra(input, from, to)
  const isCorrect = JSON.stringify(result) === JSON.stringify(expected)

  if (isCorrect) {
    console.log(`✓ ${desc}`)
    passed++
  } else {
    console.log(`✗ ${desc}`)
    console.log(`  Input:    ${input}`)
    console.log(`  Expected: ${expected}`)
    console.log(`  Got:      ${result}`)
    failed++
  }
})

console.log(`\n=== RESULTADO: ${passed} passou, ${failed} falhou ===`)

// Teste de extração de acordes com novo regex
console.log('\n=== TESTE DE EXTRAÇÃO DE ACORDES ===\n')

const extractChords = (lines) => {
  const chords = new Set()
  const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

  lines.forEach(line => {
    let match
    while ((match = chordRe.exec(line)) !== null) {
      chords.add(match[1])
    }
  })

  return Array.from(chords).sort()
}

const chordExamples = [
  {
    input: ['C F G', 'Cmaj7 F#m9 G/B'],
    desc: 'Acordes variados',
  },
]

chordExamples.forEach(({ input, desc }) => {
  const chords = extractChords(input)
  console.log(`${desc}:`)
  console.log(`  Input:  ${input}`)
  console.log(`  Acordes encontrados: ${chords.join(', ')}`)
  console.log()
})
