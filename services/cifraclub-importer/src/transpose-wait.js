export function shouldWaitForCifraChange(initialTone, targetTone) {
  if (!initialTone || !targetTone) return false
  const flats = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
  const canonical = (tone) => tone.replace(/^[A-G]b/, (root) => flats[root] ?? root)
  return canonical(initialTone) !== canonical(targetTone)
}
