import type { OriginalCifra } from './contract'
import { tonePitchClass, transposeNote } from './tone'

const chord = /^[A-G](?:#|b)?(?:(?:maj|min|m|sus|add|dim|aug|M|\+|°)?\d*(?:[#b+-]\d+)?(?:\([^\s()]+\))?)(?:\/[A-G][#b]?)?$/
export const hasTablature = (lines: string[]) => lines.some((line) => /^\s*[eBGDAE]?\s*\|[-\d~hp/\\x| ]{3,}/.test(line))

export function transposeOriginal(original: OriginalCifra, targetTone: string, confirmedTone?: string): { lines: string[]; tone: string; capoFrets: number | null } {
  const from = tonePitchClass(original.original_tone ?? confirmedTone ?? '')
  const to = tonePitchClass(targetTone)
  if (!from) throw new Error('NO_TONE')
  if (!to || from.minor !== to.minor) throw new Error('INVALID_TONE')
  const shift = (to.pc - from.pc + 12) % 12
  if (shift && (!original.transposition_supported || hasTablature(original.original_lines))) throw new Error('UNSUPPORTED_TRANSPOSE')
  const transform = (token: string) => token.replace(/(^|\/)([A-G][#b]?)/g, (_, prefix, root) => prefix + transposeNote(root, shift, targetTone.includes('b')))
  const lines = original.original_lines.map((line) => {
    if (!shift) return line
    const prefix = line.match(/^\s*\[[^\]]+\]\s*/)?.[0] ?? ''
    const content = line.slice(prefix.length)
    const tokens = content.trim().split(/\s+/)
    if (!tokens.length || !tokens.every((t) => chord.test(t) || /^[|:()\-]+$/.test(t))) return line
    const matches = [...content.matchAll(/\S+/g)]
    let output = '', position = 0
    for (const match of matches) {
      const start = match.index!
      output += ' '.repeat(Math.max(0, start - position))
      output += chord.test(match[0]) ? transform(match[0]) : match[0]
      position = output.length
    }
    return prefix + output
  })
  return { lines, tone: targetTone, capoFrets: original.capo_frets }
}
