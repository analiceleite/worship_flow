// Client address used only as a rate-limit subject. It is HMAC-hashed by the limiter
// and never stored raw. On Vercel, x-real-ip is set by the platform from the socket
// address and overwrites any value the client sent. Without it, the last
// x-forwarded-for hop is the one the nearest proxy observed. Requests whose address
// cannot be determined share one 'unknown' bucket, so they can only be limited together.
export function clientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const hops = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(hop => hop.trim())
    .filter(Boolean)
  const last = hops.at(-1)
  return last ? last.slice(0, 64) : 'unknown'
}
