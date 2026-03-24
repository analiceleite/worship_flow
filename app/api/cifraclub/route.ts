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
}

const CIFRACLUB_BASE = 'https://www.cifraclub.com.br'

const TONE_ALIASES: Record<string, string> = {
    Db: 'C#',
    Eb: 'D#',
    Gb: 'F#',
    Bb: 'A#',
    Dbm: 'C#m',
    Ebm: 'D#m',
    Gbm: 'F#m',
    Bbm: 'A#m',
}

const normalizeTone = (raw: string): string | null => {
    const cleaned = raw.trim().replace(/\s+/g, '')
    if (!/^[A-G][#b]?m?$/i.test(cleaned)) return null
    const upper = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
    return TONE_ALIASES[upper] ?? upper
}

/**
 * Extract available tones directly from the #side-tom <ul> in the page DOM.
 * Structure: <span id="side-tom"><ul><li> ½ Tom</li><li>Am<i></i></li>...</ul></span>
 * The first <li> is the "½ Tom" label — skip it and read the rest.
 */
const extractAvailableTonesFromDOM = ($: cheerio.CheerioAPI): string[] => {
    const tones: string[] = []
    const seen = new Set<string>()

    // Primary: #side-tom ul li (skip first "½ Tom" label)
    const items = $('#side-tom ul li')
    if (items.length > 1) {
        items.slice(1).each((_, el) => {
            // Each <li> may contain <i> icons — get only the direct text node
            const raw = $(el).contents().filter((_, n) => n.type === 'text').text().trim()
            const tone = normalizeTone(raw)
            if (tone && !seen.has(tone)) {
                seen.add(tone)
                tones.push(tone)
            }
        })
    }

    return tones
}

const NOTE_INDEX: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
    F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
    'A#': 10, Bb: 10, B: 11,
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const parseToneRoot = (tone: string): string | null => {
    const m = tone.trim().match(/^([A-G](?:#|b)?)/)
    return m ? m[1] : null
}

const transposeRoot = (root: string, semitones: number) => {
    const idx = NOTE_INDEX[root]
    if (idx == null) return root
    const next = (idx + semitones + 120) % 12
    const prefersFlat = root.includes('b')
    return prefersFlat ? NOTES_FLAT[next] : NOTES_SHARP[next]
}

const transposeChordSymbol = (symbol: string, semitones: number) => {
    const [main, bass] = symbol.split('/')

    const transposePart = (part: string) => {
        const m = part.match(/^([A-G](?:#|b)?)(.*)$/)
        if (!m) return part
        return `${transposeRoot(m[1], semitones)}${m[2]}`
    }

    const nextMain = transposePart(main)
    if (!bass) return nextMain
    return `${nextMain}/${transposePart(bass)}`
}

const transposeCifra = (lines: string[], fromTone: string, toTone: string): string[] => {
    const fromRoot = parseToneRoot(fromTone)
    const toRoot = parseToneRoot(toTone)
    if (!fromRoot || !toRoot) return lines
    if (fromRoot === toRoot) return lines

    const fromIdx = NOTE_INDEX[fromRoot]
    const toIdx = NOTE_INDEX[toRoot]
    if (fromIdx == null || toIdx == null) return lines

    const semitones = toIdx - fromIdx
    const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

    const isLikelyChordLine = (line: string) => {
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

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const artist = searchParams.get('artist')?.trim()
    const song = searchParams.get('song')?.trim()
    const version = searchParams.get('version')?.trim()
    const targetToneParam = searchParams.get('target_tone')?.trim()
    const keyParam = searchParams.get('key')
    const keyIndex = keyParam == null ? null : Number(keyParam)
    const targetTone = targetToneParam ? normalizeTone(targetToneParam) : null

    if (!artist || !song) {
        return NextResponse.json(
            { error: 'Parâmetros "artist" e "song" são obrigatórios.' },
            { status: 400 }
        )
    }

    const validSlug = /^[a-z0-9-]+$/
    if (!validSlug.test(artist) || !validSlug.test(song)) {
        return NextResponse.json(
            { error: 'Os slugs precisam conter apenas letras minúsculas, números e hífens.' },
            { status: 400 }
        )
    }

    const validVersion = /^[a-z0-9-]+\.html$/
    if (version && !validVersion.test(version)) {
        return NextResponse.json(
            { error: 'A versão da cifra é inválida.' },
            { status: 400 }
        )
    }

    if (keyIndex != null && (!Number.isInteger(keyIndex) || keyIndex < 0)) {
        return NextResponse.json(
            { error: 'O parâmetro "key" é inválido.' },
            { status: 400 }
        )
    }

    if (targetToneParam && !targetTone) {
        return NextResponse.json(
            { error: 'O parâmetro "target_tone" é inválido.' },
            { status: 400 }
        )
    }

    const pageUrl = version
        ? `${CIFRACLUB_BASE}/${artist}/${song}/${version}`
        : `${CIFRACLUB_BASE}/${artist}/${song}/`

    const response = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            Accept: 'text/html',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
        return NextResponse.json(
            { error: `CifraClub retornou ${response.status}. Verifique se o artista/música estão corretos.` },
            { status: response.status >= 500 ? 502 : 404 }
        )
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    // ── Song & artist ──
    const name = $('h1.t1').first().text().trim() || song
    const artistName = $('h2.t3 a').first().text().trim() || artist

    // ── Current (original) tone ──
    // CifraClub renders it in <span id="cifra_tom"> with text like "tom:\n            Cm"
    let tone = ''

    // Primary source: tone anchor inside #cifra_tom (e.g. <a ...>A</a>)
    const toneFromAnchor = normalizeTone($('#cifra_tom a').first().text())
    if (toneFromAnchor) {
        tone = toneFromAnchor
    } else {
        // Fallback within same container if markup changes.
        const cifraTomel = $('#cifra_tom').text()
        const tomMatch = cifraTomel.match(/([A-G][#b]?m?)\s*(?:\(|$)/i)
        if (tomMatch) tone = normalizeTone(tomMatch[1]) || ''
    }

    // ── Chord chart ──
    const cifraLines: string[] = []
    const preEl = $('.cifra_cnt pre').first()

    if (preEl.length) {
        preEl.text().split('\n').forEach(line => cifraLines.push(line))
    } else {
        $('pre').first().text().split('\n').forEach(line => cifraLines.push(line))
    }

    // ── Available tones: read directly from #side-tom ul li ──
    const availableTones = extractAvailableTonesFromDOM($)

    // Strict mode: no inference/fallbacks for tone list or original tone.
    if (!tone) {
        return NextResponse.json(
            { error: 'Não foi possível extrair o tom original da música no CifraClub.' },
            { status: 422 }
        )
    }

    if (availableTones.length === 0) {
        return NextResponse.json(
            { error: 'Não foi possível extrair os tons disponíveis da música no CifraClub.' },
            { status: 422 }
        )
    }

    if (!availableTones.includes(tone)) {
        return NextResponse.json(
            { error: 'Tom original não está presente na lista de tons disponíveis extraída do CifraClub.' },
            { status: 422 }
        )
    }

    // ── YouTube URL (official music link) ──
    // Important: CifraClub payload often has both:
    // - videoId: usually video lesson/aula
    // - youtubeId: official song clip
    // We must prioritize youtubeId and ignore videoId to avoid wrong links.
    let youtubeUrl = ''

    const youtubeIdMatches = [...html.matchAll(/youtubeId\s*[":=]\s*["']?([A-Za-z0-9_-]{11})["']?/gi)]
    if (youtubeIdMatches.length > 0) {
        const id = youtubeIdMatches[0][1]
        youtubeUrl = `https://www.youtube.com/watch?v=${id}`
    }

    let resolvedTone = tone
    let resolvedCifra = cifraLines

    // Optional: apply CifraClub hash key selection (e.g. #key=7) server-side.
    if (targetTone && availableTones.includes(targetTone)) {
        resolvedTone = targetTone
        resolvedCifra = transposeCifra(cifraLines, tone, targetTone)
    } else if (keyIndex != null && keyIndex < availableTones.length) {
        const targetToneFromKey = availableTones[keyIndex]
        if (targetToneFromKey) {
            resolvedTone = targetToneFromKey
            resolvedCifra = transposeCifra(cifraLines, tone, targetToneFromKey)
        }
    }

    const cifraclubUrl = keyIndex != null ? `${pageUrl}#key=${keyIndex}` : pageUrl

    return NextResponse.json({
        artist: artistName,
        name,
        tone: resolvedTone,
        available_tones: availableTones,
        youtube_url: youtubeUrl,
        cifraclub_url: cifraclubUrl,
        cifra: resolvedCifra,
    } satisfies CifraClubSong)
}