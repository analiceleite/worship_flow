import type { YouTubeSearchResult } from '@/lib/types'

/** TTL padrão do cache (30 dias). */
export const YOUTUBE_SEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Normaliza o texto de busca para aumentar taxa de cache hit.
 */
export function normalizeYoutubeSearchQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
}

/**
 * Chave estável: mesma busca + mesmo maxResults → mesmo cache.
 */
export function buildYoutubeSearchCacheKey(query: string, maxResults: number): string {
  const normalized = normalizeYoutubeSearchQuery(query)
  return `m${maxResults}:${normalized}`
}

export function getYoutubeSearchCacheExpiry(): string {
  return new Date(Date.now() + YOUTUBE_SEARCH_CACHE_TTL_MS).toISOString()
}

export function parseCachedYoutubeResults(value: unknown): YouTubeSearchResult[] | null {
  if (!Array.isArray(value)) return null
  const parsed: YouTubeSearchResult[] = []
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as YouTubeSearchResult).videoId === 'string' &&
      typeof (item as YouTubeSearchResult).title === 'string'
    ) {
      parsed.push({
        videoId: (item as YouTubeSearchResult).videoId,
        title: (item as YouTubeSearchResult).title,
        channelTitle: String((item as YouTubeSearchResult).channelTitle ?? ''),
        thumbnailUrl: String((item as YouTubeSearchResult).thumbnailUrl ?? ''),
      })
    }
  }
  return parsed.length > 0 ? parsed : null
}
