#!/usr/bin/env node
/**
 * Teste de transposição específico com os acordes da cifra "Amo o Senhor"
 * Cifra original em F
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
  if (!symbol || symbol.trim().length === 0) return symbol
  
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
  console.log(`Transposição: ${fromTone} → ${toTone} (${semitones} semitom)`)
  
  const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

  return lines.map(line => {
    const transposed = line.replace(chordRe, (token) => {
      const result = transposeChordSymbol(token, semitones)
      if (token !== result) {
        console.log(`  "${token}" → "${result}"`)
      }
      return result
    })
    return transposed
  })
}

console.log('=== TESTE: Transpor "Amo o Senhor" de F para E ===\n')

// Cifra original baseada no que o usuário mostrou
const cifra = [
  'Intro: Dm A# F C 3x',
  '',
  'F          C',
  'Amo o Senhor',
  'Dm         Am',
  'Meu Salvador',
  'A#    F     Gm            C',
  'Anelo tê-lo bem junto a mim',
  'F     C       Dm',
]

console.log('--- CIFRA ORIGINAL (em F) ---')
cifra.forEach((line, i) => {
  console.log(`${i + 1}: ${line}`)
})

console.log('\n--- TRANSPONDO PARA E ---\n')
const transposed = transposeCifra(cifra, 'F', 'E')

console.log('\n--- CIFRA TRANSPOSTA (em E) ---')
transposed.forEach((line, i) => {
  console.log(`${i + 1}: ${line}`)
})

// Testa também F → D
console.log('\n\n=== TESTE: Transpor "Amo o Senhor" de F para D ===\n')

console.log('--- TRANSPONDO PARA D ---\n')
const transposed2 = transposeCifra(cifra, 'F', 'D')

console.log('\n--- CIFRA TRANSPOSTA (em D) ---')
transposed2.forEach((line, i) => {
  console.log(`${i + 1}: ${line}`)
})
