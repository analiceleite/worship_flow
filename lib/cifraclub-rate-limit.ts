const WINDOW_MS = 60 * 60 * 1000
const MAX_REQUESTS = 10

interface Entry {
  count: number
  windowStart: number
}

const buckets = new Map<string, Entry>()

function prune(now: number) {
  if (buckets.size < 500) return
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > WINDOW_MS) buckets.delete(key)
  }
}

export function checkCifraClubRateLimit(userId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  prune(now)

  const entry = buckets.get(userId)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStart: now })
    return { allowed: true }
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSec }
  }

  entry.count += 1
  return { allowed: true }
}
