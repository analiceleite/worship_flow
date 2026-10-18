const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
export const FLAT_DISPLAY_BY_SHARP: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb', 'C#m': 'Dbm', 'D#m': 'Ebm', 'F#m': 'Gbm', 'G#m': 'Abm', 'A#m': 'Bbm' }
export function normalizeCifraClubTone(raw: string): string | null {
  const match = raw.trim().match(/^([A-Ga-g])([#b]?)(m?)$/)
  if (!match) return null
  const root = match[1].toUpperCase() + match[2]
  const index = sharp.includes(root) ? sharp.indexOf(root) : flat.indexOf(root)
  return index < 0 ? null : sharp[index] + match[3]
}
export function tonePitchClass(raw: string): { pc: number; minor: boolean } | null {
  const tone = normalizeCifraClubTone(raw)
  return tone ? { pc: sharp.indexOf(tone.replace(/m$/, '')), minor: tone.endsWith('m') } : null
}
export function tonesAreEquivalent(a: string, b: string): boolean {
  const x = tonePitchClass(a), y = tonePitchClass(b)
  return Boolean(x && y && x.pc === y.pc && x.minor === y.minor)
}
export function resolveToneInList(target: string, available: string[]): string | null {
  return available.find((tone) => tonesAreEquivalent(target, tone)) ?? null
}
export function preferDisplayTone(requested: string | null, canonical: string): string {
  return requested && tonesAreEquivalent(requested, canonical) ? requested.trim() : canonical
}
export function transposeNote(root: string, shift: number, preferFlats: boolean): string {
  const pitch = tonePitchClass(root)
  if (!pitch) throw new Error('INVALID_CHORD')
  return (preferFlats ? flat : sharp)[(pitch.pc + shift + 120) % 12]
}
export function toneOptions(original: string): string[] {
  const parsed = tonePitchClass(original)
  return parsed ? sharp.map((tone) => tone + (parsed.minor ? 'm' : '')) : []
}
