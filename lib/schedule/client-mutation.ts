'use client'

import { selectedChurchFetch } from '@/lib/auth/client-context'

/** Admin exceptions require an explicit reason; the server still authorizes them. */
export async function scheduleMutationFetch(
  url: string, init: RequestInit, allowOverride = true,
  requestReason?: (message: string) => Promise<string | null>,
) {
  let response = await selectedChurchFetch(url, init)
  if (response.status !== 409 || !allowOverride) return response
  const body = await response.clone().json()
  if (!body.override_allowed || !requestReason) return response
  const reason = (await requestReason(body.error))?.trim()
  if (!reason) return response
  response = await selectedChurchFetch(url, {
    ...init,
    body: JSON.stringify({ ...JSON.parse(String(init.body)), conflict_override_reason: reason }),
  })
  return response
}
