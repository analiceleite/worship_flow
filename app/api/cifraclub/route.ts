import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseCifraClubUrl } from '@/lib/cifraclub-url'
import {
  scrapeCifraClub,
  CifraClubScrapeError,
  normalizeCifraClubTone,
  type CifraClubSong,
} from '@/lib/cifraclub-scraper'
import { checkCifraClubRateLimit } from '@/lib/cifraclub-rate-limit'

export type { CifraClubSong }

const validSlug = /^[a-z0-9-]+$/
const validVersion = /^[a-z0-9-]+\.html$/

function resolveParams(searchParams: URLSearchParams) {
  const urlParam = searchParams.get('url')?.trim()
  if (urlParam) {
    const parsed = parseCifraClubUrl(urlParam)
    if (!parsed) return { error: 'URL do Cifra Club inválida.' as const }
    return {
      artist: parsed.artist,
      song: parsed.song,
      version: parsed.version,
      targetToneParam: searchParams.get('target_tone')?.trim(),
    }
  }

  return {
    artist: searchParams.get('artist')?.trim(),
    song: searchParams.get('song')?.trim(),
    version: searchParams.get('version')?.trim(),
    targetToneParam: searchParams.get('target_tone')?.trim(),
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const rate = checkCifraClubRateLimit(user.id)
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: `Limite de importações atingido. Tente novamente em ${rate.retryAfterSec ?? 3600} segundos.`,
      },
      { status: 429 }
    )
  }

  const { searchParams } = new URL(request.url)
  const resolved = resolveParams(searchParams)

  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const { artist, song, version, targetToneParam } = resolved

  if (!artist || !song) {
    return NextResponse.json(
      { error: 'Informe a URL do Cifra Club ou os parâmetros artist e song.' },
      { status: 400 }
    )
  }

  if (!validSlug.test(artist) || !validSlug.test(song)) {
    return NextResponse.json(
      { error: 'Os slugs precisam conter apenas letras minúsculas, números e hífens.' },
      { status: 400 }
    )
  }

  if (version && !validVersion.test(version)) {
    return NextResponse.json({ error: 'A versão da cifra é inválida.' }, { status: 400 })
  }

  const targetTone = targetToneParam ? normalizeCifraClubTone(targetToneParam) : null
  if (targetToneParam && !targetTone) {
    return NextResponse.json({ error: 'O parâmetro "target_tone" é inválido.' }, { status: 400 })
  }

  try {
    const result = await scrapeCifraClub({
      artist,
      song,
      version: version || undefined,
      targetTone,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CifraClubScrapeError) {
      const status =
        err.code === 'INVALID_TONE'
          ? 422
          : err.code === 'BLOCKED' || err.code === 'FETCH_FAILED'
            ? 502
            : 422
      return NextResponse.json(
        {
          error: err.message,
          available_tones: err.availableTones,
          code: err.code,
        },
        { status }
      )
    }
    console.error('CifraClub scrape error:', err)
    return NextResponse.json({ error: 'Erro ao importar cifra.' }, { status: 500 })
  }
}
