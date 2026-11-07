// Proxies may expose an internal request URL (e.g. 0.0.0.0) to Next.js.
// Trust the configured public origin, never arbitrary forwarded host headers.
export function isTrustedMutationOrigin(request: Request, configuredOrigin = process.env.APP_BASE_URL): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const expected = new URL(configuredOrigin ?? request.url)
    if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password) return false
    if (configuredOrigin && (expected.pathname !== '/' || expected.search || expected.hash)) return false
    return origin === expected.origin
  } catch {
    return false
  }
}
