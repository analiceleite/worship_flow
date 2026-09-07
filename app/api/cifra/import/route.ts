import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseCifralizeUrl } from '@/lib/cifralize-url'
import { parseCifraClubUrl } from '@/lib/cifraclub-url'
import {
  scrapeCifralize,
  scrapeCifralizeBySearch,
  CifralizeScrapeError,
  type ImportedCifra,
} from '@/lib/cifralize-scraper'
import { normalizeCifraClubTone } from '@/lib/cifraclub-scraper'
import {
  CifraClubImporterError,
  importFromCifraClubService,
} from '@/lib/cifraclub-importer-client'
import { checkCifralizeRateLimit, recordCifralizeImport } from '@/lib/cifralize-rate-limit'

export type { ImportedCifra }

const validSlug = /^[a-z0-9-]+$/

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const rate = checkCifralizeRateLimit(user.id)
  if (!rate.allowed) {
    const retryAfterSec = rate.retryAfterSec ?? 3600
    return NextResponse.json(
      {
        error: `Limite de importações atingido. Tente novamente em cerca de ${Math.max(1, Math.ceil(retryAfterSec / 60))} minutos ou use PDF/foto.`,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    )
  }

  const { searchParams } = new URL(request.url)
  const urlParam = searchParams.get('url')?.trim()
  const artistParam = searchParams.get('artist')?.trim()
  const songParam = searchParams.get('song')?.trim()
  const queryParam = searchParams.get('q')?.trim()
  const targetToneParam = searchParams.get('target_tone')?.trim()

  const targetTone = targetToneParam ? normalizeCifraClubTone(targetToneParam) : null
  if (targetToneParam && !targetTone) {
    return NextResponse.json({ error: 'O parâmetro "target_tone" é inválido.' }, { status: 400 })
  }

  try {
    let result: ImportedCifra

    if (urlParam) {
      const cifralizeUrl = parseCifralizeUrl(urlParam)
      const cifraClubUrl = parseCifraClubUrl(urlParam)

      if (!cifralizeUrl && !cifraClubUrl) {
        return NextResponse.json(
          {
            error:
              'URL inválida. Cole um link do CifraClub ou Cifralize, ou use a aba PDF ou foto.',
          },
          { status: 400 }
        )
      }

      if (cifraClubUrl) {
        if (!validSlug.test(cifraClubUrl.artist) || !validSlug.test(cifraClubUrl.song)) {
          return NextResponse.json({ error: 'Link do CifraClub inválido.' }, { status: 400 })
        }

        result = await importFromCifraClubService({
          url: urlParam,
          artist: cifraClubUrl.artist,
          song: cifraClubUrl.song,
          targetTone,
        })
      } else if (cifralizeUrl) {
        if (!validSlug.test(cifralizeUrl.artist) || !validSlug.test(cifralizeUrl.song)) {
          return NextResponse.json({ error: 'Link do Cifralize inválido.' }, { status: 400 })
        }

        result = await scrapeCifralize({
          artist: cifralizeUrl.artist,
          song: cifralizeUrl.song,
          targetTone: targetTone ?? cifralizeUrl.tone ?? null,
        })
      } else {
        return NextResponse.json({ error: 'Link de cifra inválido.' }, { status: 400 })
      }
    } else if (artistParam && songParam) {
      if (!validSlug.test(artistParam) || !validSlug.test(songParam)) {
        return NextResponse.json({ error: 'Artista ou música inválidos.' }, { status: 400 })
      }

      result = await scrapeCifralize({
        artist: artistParam,
        song: songParam,
        targetTone,
      })
    } else if (queryParam) {
      result = await scrapeCifralizeBySearch(queryParam, targetTone)
    } else {
      return NextResponse.json(
        { error: 'Informe a URL do CifraClub/Cifralize (parâmetro url) ou artista e música.' },
        { status: 400 }
      )
    }

    recordCifralizeImport(user.id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CifralizeScrapeError) {
      const status =
        err.code === 'INVALID_TONE'
          ? 422
          : err.code === 'NOT_FOUND' || err.code === 'NOT_IN_CATALOG' || err.code === 'NO_CIFRA'
            ? 404
            : 502
      return NextResponse.json(
        {
          error: err.message,
          available_tones: err.availableTones,
          code: err.code,
        },
        { status }
      )
    }

    if (err instanceof CifraClubImporterError) {
      return NextResponse.json(
        {
          error: err.message,
          available_tones: err.availableTones,
          code: err.code,
        },
        { status: err.status }
      )
    }

    console.error('Cifra import error:', err)
    return NextResponse.json({ error: 'Erro ao importar cifra.' }, { status: 500 })
  }
}
