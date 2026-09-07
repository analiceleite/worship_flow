import * as cheerio from 'cheerio'

export interface CifraClubSong {
  artist: string
  name: string
  tone: string
  available_tones: string[]
  youtube_url: string
  cifraclub_url: string
  cifra: string[]
  capo_frets: number
}

export interface ScrapeCifraClubParams {
  artist: string
  song: string
  version?: string
  targetTone?: string | null
}

export class CifraClubScrapeError extends Error {
  constructor(
    message: string,
    public readonly code: 'FETCH_FAILED' | 'BLOCKED' | 'NO_TONES' | 'INVALID_TONE' | 'EMPTY_CIFRA',
    public readonly availableTones?: string[]
  ) {
    super(message)
    this.name = 'CifraClubScrapeError'
  }
}

const CIFRACLUB_BASE = 'https://www.cifraclub.com.br'

const TONE_ALIASES: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Dbm: 'C#m',
  Ebm: 'D#m',
  Gbm: 'F#m',
  Abm: 'G#m',
  Bbm: 'A#m',
}

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export const normalizeCifraClubTone = (raw: string): string | null => {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!/^[A-G][#b]?m?$/i.test(cleaned)) return null
  const upper = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
  return TONE_ALIASES[upper] ?? upper
}

/** Semitom + modo (maior/menor) para comparar tons enarmônicos (Ab = G#). */
export function tonePitchClass(tone: string): { pc: number; minor: boolean } | null {
  const normalized = normalizeCifraClubTone(tone)
  if (!normalized) return null

  const minor = normalized.endsWith('m') && normalized.length > 1
  const root = minor ? normalized.slice(0, -1) : normalized
  const pc = NOTE_INDEX[root]
  if (pc === undefined) return null

  return { pc, minor }
}

export function tonesAreEquivalent(a: string, b: string): boolean {
  const pa = tonePitchClass(a)
  const pb = tonePitchClass(b)
  if (!pa || !pb) return false
  return pa.pc === pb.pc && pa.minor === pb.minor
}

/** Escolhe o rótulo da lista disponível que corresponde ao tom pedido (ex.: Ab → G#). */
export function resolveToneInList(target: string, available: string[]): string | null {
  const normalized = normalizeCifraClubTone(target)
  if (!normalized) return null
  if (available.includes(normalized)) return normalized

  for (const candidate of available) {
    if (tonesAreEquivalent(normalized, candidate)) return candidate
  }

  return null
}

export const FLAT_DISPLAY_BY_SHARP: Record<string, string> = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb',
  'C#m': 'Dbm',
  'D#m': 'Ebm',
  'F#m': 'Gbm',
  'G#m': 'Abm',
  'A#m': 'Bbm',
}

/** Preferência de exibição: mantém bemol se o usuário pediu equivalente em bemol. */
export function preferDisplayTone(requested: string | null, canonical: string): string {
  if (!requested?.trim()) return canonical
  const reqNorm = normalizeCifraClubTone(requested)
  if (!reqNorm || !tonesAreEquivalent(requested, canonical)) return canonical

  const reqDisplay = requested.trim()
  const reqNormFromDisplay = normalizeCifraClubTone(reqDisplay)
  if (reqNormFromDisplay === reqNorm && /b/.test(reqDisplay)) return reqDisplay

  const flat = FLAT_DISPLAY_BY_SHARP[canonical]
  if (flat && tonesAreEquivalent(flat, canonical)) return flat

  return canonical
}

const parseToneRoot = (tone: string | null | undefined): string | null => {
  const m = String(tone ?? '').match(/^([A-G](?:#|b)?)/)
  return m ? m[1] : null
}

const transposeRoot = (root: string, semitones: number): string => {
  const idx = NOTE_INDEX[root]
  if (idx == null) return root
  const next = (idx + semitones + 120) % 12
  const prefersFlat = root.includes('b')
  return prefersFlat ? NOTES_FLAT[next] : NOTES_SHARP[next]
}

const transposeChordSymbol = (symbol: string, semitones: number): string => {
  const [main, bass] = symbol.split('/')
  const trans = (part: string) => {
    const m = part.match(/^([A-G](?:#|b)?)(.*)$/)
    if (!m) return part
    return `${transposeRoot(m[1], semitones)}${m[2]}`
  }
  const nextMain = trans(main)
  return bass ? `${nextMain}/${trans(bass)}` : nextMain
}

const transposeCifra = (lines: string[], fromTone: string, toTone: string): string[] => {
  const fromRoot = parseToneRoot(fromTone)
  const toRoot = parseToneRoot(toTone)
  if (!fromRoot || !toRoot || fromRoot === toRoot) return lines
  const fromIdx = NOTE_INDEX[fromRoot]
  const toIdx = NOTE_INDEX[toRoot]
  if (fromIdx == null || toIdx == null) return lines

  const semitones = toIdx - fromIdx
  const chordRe =
    /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

  return lines.map((line) => line.replace(chordRe, (token) => transposeChordSymbol(token, semitones)))
}

async function fetchPage(url: string): Promise<{ $: cheerio.CheerioAPI; html: string } | null> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://www.cifraclub.com.br/',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) return null

  const html = await response.text()
  return { $: cheerio.load(html), html }
}

function extractCurrentTone($: cheerio.CheerioAPI): string | null {
  const fromAnchor = normalizeCifraClubTone($('#cifra_tom a').first().text())
  if (fromAnchor) return fromAnchor

  const raw = $('#cifra_tom').text()
  const m = raw.match(/([A-G][#b]?m?)\s*(?:\(|$)/i)
  return m ? normalizeCifraClubTone(m[1]) : null
}

function extractAvailableTones($: cheerio.CheerioAPI): Array<{ tone: string; keyIndex: number }> {
  const result: Array<{ tone: string; keyIndex: number }> = []
  const seen = new Set<string>()

  const items = $('#side-tom ul li')
  if (items.length === 0) return result

  items.each((_, el) => {
    const raw = $(el)
      .contents()
      .filter((__, n) => n.type === 'text')
      .text()
      .trim()
    const tone = normalizeCifraClubTone(raw)
    if (!tone || seen.has(tone)) return

    const anchor = $(el).find('a').first()
    const dataKey = anchor.attr('data-key')
    const href = anchor.attr('href')

    let keyIndex: number | null = null

    if (dataKey && /^-?\d+$/.test(dataKey)) {
      keyIndex = Number(dataKey)
    } else if (href) {
      const m = href.match(/key=([-]?\d+)/)
      if (m) keyIndex = Number(m[1])
    }

    if (keyIndex === null) {
      keyIndex = result.length
    }

    seen.add(tone)
    result.push({ tone, keyIndex })
  })

  return result
}

function extractCifraLines($: cheerio.CheerioAPI): string[] {
  const preEl = $('.cifra_cnt pre').first()
  const text = preEl.length ? preEl.text() : $('pre').first().text()
  return text.split('\n')
}

function extractYoutubeUrl(html: string): string {
  const m = html.match(/youtubeId\s*[":=]\s*["']?([A-Za-z0-9_-]{11})["']?/i)
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  return ''
}

function extractCapo(html: string): number {
  const m = html.match(/capotra?ste[^0-9]{0,40}?(\d{1,2})\s*[ªa]?\s*casa/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isInteger(n) && n >= 0 && n <= 12) return n
  }
  return 0
}

export function isLikelyBlockedPage(html: string, $: cheerio.CheerioAPI): boolean {
  const lower = html.toLowerCase()
  if (lower.includes('captcha') || lower.includes('cf-challenge') || lower.includes('access denied')) {
    return true
  }
  if (html.length < 800) return true
  const title = $('title').text().toLowerCase()
  if (title.includes('captcha') || title.includes('blocked')) return true
  return false
}

function assertValidCifra(lines: string[]): void {
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length === 0) {
    throw new CifraClubScrapeError(
      'Não foi possível extrair o texto da cifra. O Cifra Club pode estar bloqueando o acesso — cole a cifra manualmente ou envie um PDF.',
      'EMPTY_CIFRA'
    )
  }
}

export async function scrapeCifraClub(params: ScrapeCifraClubParams): Promise<CifraClubSong> {
  const { artist, song, version } = params
  const targetTone = params.targetTone ? normalizeCifraClubTone(params.targetTone) : null

  if (params.targetTone && !targetTone) {
    throw new CifraClubScrapeError('Tom inválido.', 'INVALID_TONE')
  }

  const basePageUrl = version
    ? `${CIFRACLUB_BASE}/${artist}/${song}/${version}`
    : `${CIFRACLUB_BASE}/${artist}/${song}/`

  const basePage = await fetchPage(basePageUrl)
  if (!basePage) {
    throw new CifraClubScrapeError(
      'Não foi possível acessar o Cifra Club. Verifique o link ou tente colar a cifra manualmente.',
      'FETCH_FAILED'
    )
  }

  const { $: $base, html: baseHtml } = basePage

  if (isLikelyBlockedPage(baseHtml, $base)) {
    throw new CifraClubScrapeError(
      'O Cifra Club bloqueou o acesso automático. Use a aba PDF da cifra.',
      'BLOCKED'
    )
  }

  const name = $base('h1.t1').first().text().trim() || song
  const artistName = $base('h2.t3 a').first().text().trim() || artist

  const availableToneEntries = extractAvailableTones($base)
  if (availableToneEntries.length === 0) {
    throw new CifraClubScrapeError(
      'Não foi possível extrair os tons desta música no Cifra Club.',
      'NO_TONES'
    )
  }

  const defaultToneEntry = availableToneEntries[0]
  const availableTonesOnly = availableToneEntries.map((e) => e.tone)
  const youtubeUrl = extractYoutubeUrl(baseHtml)
  const defaultCifra = extractCifraLines($base)
  const baseCapo = extractCapo(baseHtml)
  const defaultToneResolved = extractCurrentTone($base) ?? defaultToneEntry.tone

  assertValidCifra(defaultCifra)

  if (!targetTone) {
    return {
      artist: artistName,
      name,
      tone: defaultToneResolved,
      available_tones: availableTonesOnly,
      youtube_url: youtubeUrl,
      cifraclub_url: basePageUrl,
      cifra: defaultCifra,
      capo_frets: baseCapo,
    }
  }

  const targetEntry = availableToneEntries.find((e) => e.tone === targetTone)
  if (!targetEntry) {
    throw new CifraClubScrapeError(
      `O tom "${targetTone}" não está disponível. Tons: ${availableTonesOnly.join(', ')}.`,
      'INVALID_TONE',
      availableTonesOnly
    )
  }

  if (targetEntry.tone === defaultToneResolved) {
    return {
      artist: artistName,
      name,
      tone: defaultToneResolved,
      available_tones: availableTonesOnly,
      youtube_url: youtubeUrl,
      cifraclub_url: `${basePageUrl}#key=${targetEntry.keyIndex}`,
      cifra: defaultCifra,
      capo_frets: baseCapo,
    }
  }

  const targetPosition = availableToneEntries.findIndex((e) => e.tone === targetTone)
  const candidateKeys = Array.from(
    new Set([targetEntry.keyIndex, targetPosition + 1, targetPosition].filter((v) => v != null))
  )

  for (const key of candidateKeys) {
    const keyedPageUrl = `${basePageUrl}?key=${key}`
    const keyedPage = await fetchPage(keyedPageUrl)
    if (!keyedPage) continue

    const { $: $keyed, html: keyedHtml } = keyedPage
    let resolvedTone = extractCurrentTone($keyed)
    if (!resolvedTone) resolvedTone = targetEntry.tone
    if (resolvedTone !== targetEntry.tone) continue

    const keyedCifra = extractCifraLines($keyed)
    assertValidCifra(keyedCifra)
    const keyedCapo = extractCapo(keyedHtml) || baseCapo

    return {
      artist: artistName,
      name,
      tone: resolvedTone,
      available_tones: availableTonesOnly,
      youtube_url: youtubeUrl,
      cifraclub_url: `${basePageUrl}#key=${key}`,
      cifra: keyedCifra,
      capo_frets: keyedCapo,
    }
  }

  const fallbackCifra = transposeCifra(defaultCifra, defaultToneResolved, targetEntry.tone)
  assertValidCifra(fallbackCifra)

  return {
    artist: artistName,
    name,
    tone: targetEntry.tone,
    available_tones: availableTonesOnly,
    youtube_url: youtubeUrl,
    cifraclub_url: basePageUrl,
    cifra: fallbackCifra,
    capo_frets: baseCapo,
  }
}
