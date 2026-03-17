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

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const artist = searchParams.get('artist')?.trim()
    const song = searchParams.get('song')?.trim()
    const version = searchParams.get('version')?.trim()

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

    return NextResponse.json({
        artist: artistName,
        name,
        tone,
        available_tones: availableTones,
        youtube_url: youtubeUrl,
        cifraclub_url: pageUrl,
        cifra: cifraLines,
    } satisfies CifraClubSong)
}