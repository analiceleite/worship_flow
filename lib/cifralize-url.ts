export interface ParsedCifralizeUrl {
  artist: string
  song: string
  tone?: string
}

const CIFRALIZE_HOSTS = new Set(['cifralize.com.br', 'www.cifralize.com.br'])

/**
 * Parses a Cifralize public song URL: /:artista/:música?tom=...
 */
export function parseCifralizeUrl(input: string): ParsedCifralizeUrl | null {
  try {
    const raw = String(input || '').trim()
    if (!raw) return null

    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!CIFRALIZE_HOSTS.has(url.hostname.toLowerCase())) return null

    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts[0] === 'embed' && parts.length >= 3) {
      return {
        artist: parts[1],
        song: parts[2],
        tone: url.searchParams.get('tom')?.trim() || undefined,
      }
    }

    if (parts.length < 2) return null
    if (['search', 'c', 'songs', 'chords', 'api'].includes(parts[0])) return null

    return {
      artist: parts[0],
      song: parts[1],
      tone: url.searchParams.get('tom')?.trim() || undefined,
    }
  } catch {
    return null
  }
}

export function isCifralizeUrl(input: string): boolean {
  return parseCifralizeUrl(input) !== null
}

export function buildCifralizeSongUrl(artist: string, song: string, tone?: string | null): string {
  const base = `https://cifralize.com.br/${artist}/${song}`
  if (!tone?.trim()) return base
  return `${base}?tom=${encodeURIComponent(tone.trim())}`
}
