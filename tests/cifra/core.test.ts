import { expect, test } from 'vitest'

test('canonical_url_rejects_unsafe_inputs_and_preserves_version', async () => {
  const { canonicalizeCifraUrl: parse } = await import('@/lib/cifra/url')
  expect(parse('https://cifraclub.com.br/artista/musica/?utm_source=x').canonicalUrl).toBe('https://www.cifraclub.com.br/artista/musica/')
  expect(parse('https://www.cifraclub.com.br/artista/musica/versao.html').canonicalUrl).toBe('https://www.cifraclub.com.br/artista/musica/versao.html')
  for (const bad of ['http://cifraclub.com.br/a/b/', 'https://x@cifraclub.com.br/a/b/', 'https://cifraclub.com.br:444/a/b/', 'https://cifraclub.com.br/a/b/?unknown=x', 'https://cifraclub.com.br/a/b/extra/wrong']) expect(() => parse(bad)).toThrow()
})

const base = { contract_version: 2 as const, parser_version: '2', source: 'cifraclub' as const, cipher_url: 'https://www.cifraclub.com.br/artista/musica/', artist: 'Artista', name: 'Musica', original_lines: ['C/E   Bbmaj7', 'A paz é real'], original_tone: 'C', capo_frets: null, youtube_url: null, transposition_supported: true, warnings: [] }

test('transposes_only_chords_from_immutable_original', async () => {
  const { transposeOriginal } = await import('@/lib/cifra/transpose')
  expect(transposeOriginal(base, 'D').lines).toEqual(['D/F#  Cmaj7', 'A paz é real'])
  expect(transposeOriginal(base, 'C').lines).toEqual(base.original_lines)
  expect(() => transposeOriginal(base, 'Dm')).toThrow()
  expect(() => transposeOriginal({ ...base, original_tone: null }, 'D')).toThrow()
  expect(() => transposeOriginal({ ...base, original_lines: ['e|--0--2--|'] }, 'D')).toThrow()
  expect(base.original_lines).toEqual(['C/E   Bbmaj7', 'A paz é real'])
})

test('contract_keeps_unknown_values_and_rejects_oversized_payload', async () => {
  const { OriginalCifraSchema } = await import('@/lib/cifra/contract')
  expect(OriginalCifraSchema.parse(base).capo_frets).toBeNull()
  expect(OriginalCifraSchema.safeParse({ ...base, original_lines: Array(3001).fill('G') }).success).toBe(false)
  expect(OriginalCifraSchema.safeParse({ ...base, original_lines: ['G'.repeat(2001)] }).success).toBe(false)
  expect(OriginalCifraSchema.safeParse({ ...base, capo_frets: 13 }).success).toBe(false)
  expect(OriginalCifraSchema.safeParse({ ...base, cipher_url: 'https://localhost/secret' }).success).toBe(false)
})
