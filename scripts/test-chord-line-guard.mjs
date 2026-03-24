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
  if (!fromRoot || !toRoot || fromRoot === toRoot) return lines
  const semitones = NOTE_INDEX[toRoot] - NOTE_INDEX[fromRoot]
  const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g
  const isLikelyChordLine = (line) => {
    const regex = new RegExp(chordRe)
    const matches = [...line.matchAll(regex)]
    if (matches.length >= 2) return true
    if (matches.length === 1 && line.trim() === matches[0][0]) return true
    return false
  }
  return lines.map((line) => {
    if (!isLikelyChordLine(line)) return line
    return line.replace(chordRe, (token) => transposeChordSymbol(token, semitones))
  })
}

const lines = [
  'Em',
  'Eis me aqui senhor',
  'D9',
  'A minha vida a Ti eu dou',
]
const out = transposeCifra(lines, 'F#', 'E')
console.log(out.join('\n'))
