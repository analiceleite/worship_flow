import { NextRequest, NextResponse } from 'next/server'
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

const CIFRACLUB_BASE = 'https://www.cifraclub.com.br'

const TONE_ALIASES: Record<string, string> = {
    Db: 'C#', Eb: 'D#', Gb: 'F#', Bb: 'A#',
    Dbm: 'C#m', Ebm: 'D#m', Gbm: 'F#m', Bbm: 'A#m',
}

const NOTE_INDEX: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
    F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
    'A#': 10, Bb: 10, B: 11,
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const normalizeTone = (raw: string): string | null => {
    const cleaned = raw.trim().replace(/\s+/g, '')
    if (!/^[A-G][#b]?m?$/i.test(cleaned)) return null
    const upper = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
    return TONE_ALIASES[upper] ?? upper
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
    const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

    return lines.map(line => line.replace(chordRe, token => transposeChordSymbol(token, semitones)))
}

// Transpose by a fixed number of semitones (used to undo capo shapes)
const transposeCifraBySemitones = (lines: string[], semitones: number): string[] => {
    if (!semitones) return lines
    const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|Â°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g
    return lines.map(line => line.replace(chordRe, token => transposeChordSymbol(token, semitones)))
}

// Transpose a tone name by semitones, preserving accidental preference
const transposeToneName = (tone: string, semitones: number): string => {
    const root = parseToneRoot(tone)
    if (!root || !semitones) return tone
    const idx = NOTE_INDEX[root]
    if (idx == null) return tone
    const prefersFlat = root.includes('b')
    const next = (idx + semitones + 120) % 12
    const table = prefersFlat ? NOTES_FLAT : NOTES_SHARP
    const base = table[next]
    const isMinor = /m$/.test(tone.trim())
    return isMinor ? `${base}m` : base
}

/**
 * Fetches a CifraClub page and returns the parsed HTML via cheerio.
 */
async function fetchPage(url: string): Promise<{ $: cheerio.CheerioAPI; html: string } | null> {
    const response = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            Accept: 'text/html',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) return null

    const html = await response.text()
    return { $: cheerio.load(html), html }
}

/**
 * Extract the tone rendered for the current page from #cifra_tom.
 */
function extractCurrentTone($: cheerio.CheerioAPI): string | null {
    const fromAnchor = normalizeTone($('#cifra_tom a').first().text())
    if (fromAnchor) return fromAnchor

    const raw = $('#cifra_tom').text()
    const m = raw.match(/([A-G][#b]?m?)\s*(?:\(|$)/i)
    return m ? normalizeTone(m[1]) : null
}

/**
 * Extract available tones from #side-tom ul li.
 * Prefers the real ?key= value (data-key / href); otherwise falls back to sequential order.
 */
function extractAvailableTones($: cheerio.CheerioAPI): Array<{ tone: string; keyIndex: number }> {
    const result: Array<{ tone: string; keyIndex: number }> = []
    const seen = new Set<string>()

    const items = $('#side-tom ul li')
    if (items.length === 0) return result

    items.each((_, el) => {
        const raw = $(el).contents().filter((__, n) => n.type === 'text').text().trim()
        const tone = normalizeTone(raw)
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
            keyIndex = result.length // sequential fallback
        }

        seen.add(tone)
        result.push({ tone, keyIndex })
    })

    return result
}

/**
 * Extract the cifra lines from .cifra_cnt pre or the first <pre> as fallback.
 */
function extractCifraLines($: cheerio.CheerioAPI): string[] {
    const preEl = $('.cifra_cnt pre').first()
    const text = preEl.length ? preEl.text() : $('pre').first().text()
    return text.split('\n')
}

/**
 * Extract YouTube URL from the page HTML.
 */
function extractYoutubeUrl(html: string): string {
    const m = html.match(/youtubeId\s*[":=]\s*["']?([A-Za-z0-9_-]{11})["']?/i)
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`
    return ''
}

/**
 * Extract capo (casas) from page HTML text. Returns 0 when absent.
 */
function extractCapo(html: string): number {
    // Match only the phrase that includes "casa" to avoid unrelated numbers.
    const m = html.match(/capotra?ste[^0-9]{0,40}?(\d{1,2})\s*[ªa]?\s*casa/i)
    if (m) {
        const n = Number(m[1])
        if (Number.isInteger(n) && n >= 0 && n <= 12) return n
    }
    return 0
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const artist = searchParams.get('artist')?.trim()
    const song = searchParams.get('song')?.trim()
    const version = searchParams.get('version')?.trim()
    const targetToneParam = searchParams.get('target_tone')?.trim()

    console.log('Received parameters:', { artist, song, version, targetToneParam })

    // Validation
    if (!artist || !song) {
        console.error('Missing required parameters:', { artist, song })
        return NextResponse.json(
            { error: 'Parâmetros "artist" e "song" são obrigatórios.' },
            { status: 400 }
        )
    }

    const validSlug = /^[a-z0-9-]+$/
    if (!validSlug.test(artist) || !validSlug.test(song)) {
        console.error('Invalid slugs:', { artist, song })
        return NextResponse.json(
            { error: 'Os slugs precisam conter apenas letras minúsculas, números e hífens.' },
            { status: 400 }
        )
    }

    const validVersion = /^[a-z0-9-]+\.html$/
    if (version && !validVersion.test(version)) {
        console.error('Invalid version:', version)
        return NextResponse.json(
            { error: 'A versão da cifra é inválida.' },
            { status: 400 }
        )
    }

    const targetTone = targetToneParam ? normalizeTone(targetToneParam) : null
    if (targetToneParam && !targetTone) {
        console.error('Invalid target tone:', targetToneParam)
        return NextResponse.json(
            { error: 'O parâmetro "target_tone" é inválido.' },
            { status: 400 }
        )
    }

    // Step 1: fetch default page
    const basePageUrl = version
        ? `${CIFRACLUB_BASE}/${artist}/${song}/${version}`
        : `${CIFRACLUB_BASE}/${artist}/${song}/`

    console.log('Fetching CifraClub page:', basePageUrl)

    const basePage = await fetchPage(basePageUrl)
    if (!basePage) {
        console.error('Failed to fetch CifraClub page:', basePageUrl)
        return NextResponse.json(
            { error: 'Não foi possível acessar o CifraClub. Verifique se o artista/música estão corretos.' },
            { status: 502 }
        )
    }

    const { $: $base, html: baseHtml } = basePage
    console.log('Fetched CifraClub page successfully.')

    const name = $base('h1.t1').first().text().trim() || song
    const artistName = $base('h2.t3 a').first().text().trim() || artist

    const availableToneEntries = extractAvailableTones($base)
    if (availableToneEntries.length === 0) {
        return NextResponse.json(
            { error: 'Não foi possível extrair os tons disponíveis desta música no CifraClub.' },
            { status: 422 }
        )
    }

    const defaultToneEntry = availableToneEntries[0]
    const availableTonesOnly = availableToneEntries.map(e => e.tone)
    const youtubeUrl = extractYoutubeUrl(baseHtml)
    const defaultCifra = extractCifraLines($base)
    const baseCapo = extractCapo(baseHtml)
    // Tone as shown on the page (already aligned with the shapes/capo presented)
    const defaultToneResolved = extractCurrentTone($base) ?? defaultToneEntry.tone

    // Step 2: respond according to requested tone
    if (!targetTone) {
        return NextResponse.json({
            artist: artistName,
            name,
            tone: defaultToneResolved,
            available_tones: availableTonesOnly,
            youtube_url: youtubeUrl,
            cifraclub_url: basePageUrl,
            cifra: defaultCifra,
            capo_frets: baseCapo,
        } satisfies CifraClubSong)
    }

    const targetEntry = availableToneEntries.find(e => e.tone === targetTone)
    if (!targetEntry) {
        return NextResponse.json(
            {
                error: `O tom "${targetTone}" não está disponível para esta música no CifraClub. Tons disponíveis: ${availableTonesOnly.join(', ')}.`,
                available_tones: availableTonesOnly,
            },
            { status: 422 }
        )
    }

    if (targetEntry.tone === defaultToneResolved) {
        return NextResponse.json({
            artist: artistName,
            name,
            tone: defaultToneResolved,
            available_tones: availableTonesOnly,
            youtube_url: youtubeUrl,
            cifraclub_url: `${basePageUrl}#key=${targetEntry.keyIndex}`,
            cifra: defaultCifra,
            capo_frets: baseCapo,
        } satisfies CifraClubSong)
    }

    // Step 3: fetch the specific tone directly from CifraClub (no transposição local)
    const targetPosition = availableToneEntries.findIndex(e => e.tone === targetTone)
    const candidateKeys = Array.from(new Set([
        targetEntry.keyIndex,
        targetPosition + 1,
        targetPosition,
    ].filter(v => v != null)))

    for (const key of candidateKeys) {
        const keyedPageUrl = `${basePageUrl}?key=${key}`
        const keyedPage = await fetchPage(keyedPageUrl)
        if (!keyedPage) continue

        const { $: $keyed, html: keyedHtml } = keyedPage
        let resolvedTone = extractCurrentTone($keyed)
        // If the page doesn't expose the tone, assume it matches the requested one.
        if (!resolvedTone) resolvedTone = targetEntry.tone
        if (resolvedTone !== targetEntry.tone) continue

        const keyedCifra = extractCifraLines($keyed)
        const keyedCapo = extractCapo(keyedHtml) || baseCapo

        return NextResponse.json({
            artist: artistName,
            name,
            tone: resolvedTone,
            available_tones: availableTonesOnly,
            youtube_url: youtubeUrl,
            cifraclub_url: `${basePageUrl}#key=${key}`,
            cifra: keyedCifra,
            capo_frets: keyedCapo,
        } satisfies CifraClubSong)
    }

    // Fallback: if CifraClub não retornou página específica, use a cifra padrão e transpõe localmente.
    const fallbackCifra = transposeCifra(defaultCifra, defaultToneResolved, targetEntry.tone)
    return NextResponse.json({
        artist: artistName,
        name,
        tone: targetEntry.tone,
        available_tones: availableTonesOnly,
        youtube_url: youtubeUrl,
        cifraclub_url: basePageUrl,
        cifra: fallbackCifra,
        capo_frets: baseCapo,
    } satisfies CifraClubSong)
}


