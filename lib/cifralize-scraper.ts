import * as cheerio from 'cheerio'
import { buildCifralizeSongUrl } from '@/lib/cifralize-url'
import { normalizeCifraClubTone } from '@/lib/cifraclub-scraper'

export interface ImportedCifra {
  artist: string
  name: string
  tone: string
  available_tones: string[]
  youtube_url: string
  cipher_url: string
  cifra: string[]
  capo_frets: number
}

export interface ScrapeCifralizeParams {
  artist: string
  song: string
  targetTone?: string | null
}

export class CifralizeScrapeError extends Error {
  constructor(
    message: string,
    public readonly code: 'FETCH_FAILED' | 'NOT_FOUND' | 'NO_CIFRA' | 'INVALID_TONE' | 'NOT_IN_CATALOG',
    public readonly availableTones?: string[]
  ) {
    super(message)
    this.name = 'CifralizeScrapeError'
  }
}

const CIFRALIZE_BASE = 'https://cifralize.com.br'

export interface CifralizeSearchSong {
  title: string
  artist_name: string
  artist_slug: string
  song_slug: string
  url: string
}

async function fetchHtml(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      Referer: `${CIFRALIZE_BASE}/`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })

  if (response.status === 404) return null
  if (!response.ok) return null
  return response.text()
}

function flattenChordsDisplayHtml(html: string): string[] {
  let text = html
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<span class=['"]chord-section['"]>([^<]*)<\/span>/gi, '\n$1\n')
  text = text.replace(/<span class=['"]chord['"]>([^<]*)<\/span>/gi, '$1')
  text = text.replace(/<[^>]+>/g, '')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  return text.split('\n').map((line) => line.replace(/\r/g, '').replace(/[ \t]+$/g, ''))
}

function extractAvailableTones($: cheerio.CheerioAPI): string[] {
  const tones: string[] = []
  const seen = new Set<string>()

  $('.transpose-key-btn').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/[?&]tom=([^&]+)/i)
    if (!m) return
    const tone = normalizeCifraClubTone(decodeURIComponent(m[1]))
    if (!tone || seen.has(tone)) return
    seen.add(tone)
    tones.push(tone)
  })

  return tones
}

function extractCurrentTone($: cheerio.CheerioAPI): string | null {
  const active = $('.transpose-key-btn.active').first().text().trim()
  if (active) {
    const t = normalizeCifraClubTone(active)
    if (t) return t
  }

  const modalHint = $('#transposeModalLabel').parent().find('small').text()
  const m = modalHint.match(/Tom atual:\s*([A-G][#b]?m?)/i)
  if (m) return normalizeCifraClubTone(m[1])

  const headerTone = $('.transpose-btn').first().text()
  const m2 = headerTone.match(/Tom:\s*([A-G][#b]?m?)/i)
  if (m2) return normalizeCifraClubTone(m[2])

  return null
}

function extractTitle($: cheerio.CheerioAPI, fallbackSong: string): string {
  const h1 = $('h1').first().text().trim()
  if (h1) {
    const parts = h1.split(/\s*[-–|]\s*/)
    if (parts.length >= 2) return parts[0].trim()
    return h1
  }

  const titleTag = $('title').text()
  const m = titleTag.match(/Cifralize\s*\|\s*(.+?)\s*-\s*/i)
  if (m) return m[1].trim()

  return fallbackSong.replace(/-/g, ' ')
}

function extractArtistName($: cheerio.CheerioAPI, fallbackArtist: string): string {
  const h1 = $('h1').first().text().trim()
  if (h1) {
    const parts = h1.split(/\s*[-–|]\s*/)
    if (parts.length >= 2) return parts[parts.length - 1].trim()
  }

  const titleTag = $('title').text()
  const m = titleTag.match(/-\s*([^|]+?)\s*$/i)
  if (m) return m[1].trim()

  return fallbackArtist.replace(/-/g, ' ')
}

function extractYoutubeUrl(html: string): string {
  const m = html.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i)
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  const m2 = html.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i)
  if (m2) return `https://www.youtube.com/watch?v=${m2[1]}`
  return ''
}

function assertValidCifra(lines: string[]): void {
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length === 0) {
    throw new CifralizeScrapeError(
      'Não foi possível extrair o texto da cifra no Cifralize.',
      'NO_CIFRA'
    )
  }
}

export async function searchCifralize(query: string): Promise<CifralizeSearchSong[]> {
  const q = query.trim()
  if (!q) return []

  const url = `${CIFRALIZE_BASE}/search?q=${encodeURIComponent(q)}&format=json`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; WorshipFlow/1.0)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) return []

  const data = (await response.json()) as {
    songs?: Array<{
      title?: string
      artist_name?: string
      url?: string
    }>
  }

  return (data.songs ?? [])
    .map((row) => {
      const path = String(row.url ?? '').replace(/^\/+/, '')
      const [artist_slug, song_slug] = path.split('/')
      if (!artist_slug || !song_slug) return null
      return {
        title: row.title ?? song_slug,
        artist_name: row.artist_name ?? artist_slug,
        artist_slug,
        song_slug,
        url: `${CIFRALIZE_BASE}/${artist_slug}/${song_slug}`,
      }
    })
    .filter((row): row is CifralizeSearchSong => row !== null)
}

export async function scrapeCifralize(params: ScrapeCifralizeParams): Promise<ImportedCifra> {
  const { artist, song } = params
  const targetTone = params.targetTone ? normalizeCifraClubTone(params.targetTone) : null

  if (params.targetTone && !targetTone) {
    throw new CifralizeScrapeError('Tom inválido.', 'INVALID_TONE')
  }

  const pageUrl = buildCifralizeSongUrl(artist, song, targetTone)
  const html = await fetchHtml(pageUrl)

  if (!html) {
    throw new CifralizeScrapeError(
      'Música não encontrada no Cifralize. Use a aba PDF ou foto.',
      'NOT_FOUND'
    )
  }

  if (html.includes('Página Não Encontrada') || html.includes('display-1">404')) {
    throw new CifralizeScrapeError(
      'Música não encontrada no Cifralize. Use a aba PDF ou foto.',
      'NOT_FOUND'
    )
  }

  const $ = cheerio.load(html)
  const chordsHtml = $('.chords-display').first().html()

  if (!chordsHtml?.trim()) {
    throw new CifralizeScrapeError(
      'Cifra indisponível no Cifralize para este link. Use a aba PDF ou foto.',
      'NO_CIFRA'
    )
  }

  const cifra = flattenChordsDisplayHtml(chordsHtml)
  assertValidCifra(cifra)

  const available_tones = extractAvailableTones($)
  const resolvedTone = extractCurrentTone($) ?? targetTone ?? available_tones[0] ?? 'C'

  if (targetTone && available_tones.length > 0 && !available_tones.includes(targetTone)) {
    throw new CifralizeScrapeError(
      `O tom "${targetTone}" não está disponível. Tons: ${available_tones.join(', ')}.`,
      'INVALID_TONE',
      available_tones
    )
  }

  return {
    artist: extractArtistName($, artist),
    name: extractTitle($, song),
    tone: targetTone ?? resolvedTone,
    available_tones: available_tones.length > 0 ? available_tones : [resolvedTone],
    youtube_url: extractYoutubeUrl(html),
    cipher_url: pageUrl,
    cifra,
    capo_frets: 0,
  }
}

/** Resolve artista/música por busca quando não há URL exata. */
export async function scrapeCifralizeBySearch(query: string, targetTone?: string | null): Promise<ImportedCifra> {
  const results = await searchCifralize(query)
  if (results.length === 0) {
    throw new CifralizeScrapeError(
      'Música não encontrada no Cifralize. Use a aba PDF ou foto.',
      'NOT_IN_CATALOG'
    )
  }

  const best = results[0]
  return scrapeCifralize({
    artist: best.artist_slug,
    song: best.song_slug,
    targetTone,
  })
}
