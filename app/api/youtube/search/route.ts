import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { YouTubeSearchResult } from '@/lib/types'
import {
  buildYoutubeSearchCacheKey,
  getYoutubeSearchCacheExpiry,
  parseCachedYoutubeResults,
} from '@/lib/youtube-search-cache'

interface YouTubeSearchItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
  }
}

function mapYouTubeItems(items: YouTubeSearchItem[] | undefined): YouTubeSearchResult[] {
  return (items ?? [])
    .map((item) => {
      const videoId = item.id?.videoId
      if (!videoId) return null
      return {
        videoId,
        title: item.snippet?.title ?? 'Sem título',
        channelTitle: item.snippet?.channelTitle ?? '',
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          '',
      } satisfies YouTubeSearchResult
    })
    .filter((item): item is YouTubeSearchResult => item !== null)
}

async function fetchFromYouTubeApi(
  apiKey: string,
  query: string,
  maxResults: number
): Promise<YouTubeSearchResult[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('q', query)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('relevanceLanguage', 'pt')
  url.searchParams.set('safeSearch', 'moderate')

  const response = await fetch(url.toString(), { cache: 'no-store' })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('YouTube API error:', response.status, body)
    throw new Error('YOUTUBE_API_ERROR')
  }

  const data = (await response.json()) as { items?: YouTubeSearchItem[] }
  return mapYouTubeItems(data.items)
}

async function readCache(
  cacheKey: string,
  maxResults: number
): Promise<YouTubeSearchResult[] | null> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('youtube_search_cache')
    .select('results, max_results')
    .eq('query_key', cacheKey)
    .gt('expires_at', now)
    .maybeSingle()

  if (error) {
    if (/youtube_search_cache/i.test(error.message)) {
      return null
    }
    console.warn('YouTube cache read failed:', error.message)
    return null
  }

  if (!data) return null

  const results = parseCachedYoutubeResults(data.results)
  if (!results) return null

  // Se pediram menos resultados que o cache guardou, corta; se pediram mais, ignora cache.
  if (data.max_results < maxResults) return null

  return results.slice(0, maxResults)
}

async function writeCache(
  cacheKey: string,
  queryText: string,
  maxResults: number,
  results: YouTubeSearchResult[]
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('youtube_search_cache').upsert(
    {
      query_key: cacheKey,
      query_text: queryText,
      max_results: maxResults,
      results,
      expires_at: getYoutubeSearchCacheExpiry(),
    },
    { onConflict: 'query_key' }
  )

  if (error && !/youtube_search_cache/i.test(error.message)) {
    console.warn('YouTube cache write failed:', error.message)
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

  const apiKey = process.env.YOUTUBE_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Busca no YouTube não configurada (YOUTUBE_API_KEY).' },
      { status: 503 }
    )
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return NextResponse.json({ error: 'Informe ao menos 2 caracteres para buscar.' }, { status: 400 })
  }

  const maxResults = Math.min(
    12,
    Math.max(1, Number(request.nextUrl.searchParams.get('maxResults') ?? '8'))
  )

  const skipCache =
    request.nextUrl.searchParams.get('refresh') === '1' ||
    request.nextUrl.searchParams.get('refresh') === 'true'

  const cacheKey = buildYoutubeSearchCacheKey(q, maxResults)

  if (!skipCache) {
    const cached = await readCache(cacheKey, maxResults)
    if (cached) {
      return NextResponse.json({ results: cached, cached: true })
    }
  }

  try {
    const results = await fetchFromYouTubeApi(apiKey, q, maxResults)
    if (results.length > 0) {
      await writeCache(cacheKey, q, maxResults, results)
    }
    return NextResponse.json({ results, cached: false })
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível buscar vídeos no YouTube.' },
      { status: 502 }
    )
  }
}
