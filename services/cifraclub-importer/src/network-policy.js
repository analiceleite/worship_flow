import dns from 'node:dns/promises'
import https from 'node:https'

const hosts = new Set(['cifraclub.com.br', 'www.cifraclub.com.br', 'cifralize.com.br', 'www.cifralize.com.br', 'static.cifraclub.com.br'])
export { hosts }

function isPrivateAddress(address) {
  const lower = address.toLowerCase()
  if (lower.includes(':')) {
    return lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('2001:db8') ||
      (lower.startsWith('::ffff:') && isPrivateAddress(lower.split(':').pop()))
  }
  const octets = lower.split('.')
  if (octets.length !== 4 || !octets.every((o) => /^\d+$/.test(o) && Number(o) >= 0 && Number(o) <= 255)) return true
  const n = octets.map(Number)
  return n[0] === 10 ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    n[0] === 127 ||
    (n[0] === 169 && n[1] === 254) ||
    n[0] === 0 ||
    n[0] >= 224
}

export function assertAllowedDestination(input, addresses) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.has(url.hostname)) throw Error('INVALID_DESTINATION')
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address))) throw Error('PRIVATE_DESTINATION')
}

export async function resolveDestination(url, resolve = (host) => dns.lookup(host, { all: true })) {
  assertAllowedDestination(url, ['8.8.8.8'])
  const entries = await resolve(new URL(url).hostname)
  assertAllowedDestination(url, entries.map((entry) => entry.address))
  return entries[0]
}

export async function fetchSource(url, signal, redirects = 0) {
  if (redirects > 3) throw Error('TOO_MANY_REDIRECTS')
  const entry = await resolveDestination(url)
  if (signal.aborted) throw signal.reason
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, { signal, agent: false, lookup: (_host, _options, callback) => callback(null, entry.address, entry.family), headers: { 'User-Agent': 'WorshipFlow/2.0', Accept: 'text/html' } }, resolve)
    req.on('error', reject)
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const next = new URL(response.headers.location || '', url).href
    response.destroy()
    return fetchSource(next, signal, redirects + 1)
  }
  if (response.statusCode !== 200) { response.destroy(); throw Error(response.statusCode === 404 ? 'NOT_FOUND' : response.statusCode === 429 ? 'UPSTREAM_RATE_LIMITED' : response.statusCode === 403 ? 'BLOCKED' : 'UPSTREAM_FAILED') }
  const chunks = []; let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) { response.destroy(); throw Error('PAYLOAD_TOO_LARGE') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
