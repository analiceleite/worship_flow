export type CifraSource = 'cifraclub' | 'cifralize'
export function canonicalizeCifraUrl(input: string): { source: CifraSource; canonicalUrl: string; requestedTone: string | null } {
  const url = new URL(input.includes('://') ? input : `https://${input}`)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('INVALID_URL')
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!['cifraclub.com.br', 'cifralize.com.br'].includes(host)) throw new Error('INVALID_URL')
  const source = host === 'cifraclub.com.br' ? 'cifraclub' : 'cifralize'
  const parts = url.pathname.split('/').filter(Boolean)
  if (source === 'cifralize' && parts[0] === 'embed') parts.shift()
  if (parts.length < 2 || parts.length > (source === 'cifraclub' ? 3 : 2) || !parts.slice(0, 2).every((v) => /^[a-z0-9-]+$/.test(v))) throw new Error('INVALID_URL')
  if (parts[2] && !/^[a-z0-9-]+\.html$/.test(parts[2])) throw new Error('UNSUPPORTED_VERSION')
  let requestedTone: string | null = null
  for (const [key, value] of url.searchParams) {
    if (/^utm_/.test(key) || ['fbclid', 'gclid'].includes(key)) continue
    if (source === 'cifralize' && key === 'tom') { requestedTone = value; continue }
    throw new Error('UNSUPPORTED_URL_PARAMETER')
  }
  // Key indices are site-specific, not musical notes: never silently interpret them.
  if (url.hash) throw new Error('UNSUPPORTED_URL_FRAGMENT: remova o fragmento do link e selecione o tom no aplicativo')
  const canonicalUrl = source === 'cifraclub'
    ? `https://www.cifraclub.com.br/${parts.join('/')}${parts[2] ? '' : '/'}`
    : `https://cifralize.com.br/${parts.join('/')}`
  return { source, canonicalUrl, requestedTone }
}
