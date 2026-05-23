export interface ParsedCifraClubUrl {
  artist: string
  song: string
  version?: string
}

/**
 * Parses a Cifra Club URL into artist/song slugs and optional version file.
 */
export function parseCifraClubUrl(input: string): ParsedCifraClubUrl | null {
  try {
    const raw = String(input || '').trim()
    if (!raw) return null

    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase()
    if (host !== 'www.cifraclub.com.br' && host !== 'cifraclub.com.br') {
      return null
    }

    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) return null

    const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
    return { artist: parts[0], song: parts[1], version }
  } catch {
    return null
  }
}

export function isCifraClubUrl(input: string): boolean {
  return parseCifraClubUrl(input) !== null
}
