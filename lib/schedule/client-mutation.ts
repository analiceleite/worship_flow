'use client'

import { selectedChurchFetch } from '@/lib/auth/client-context'

/** Admin exceptions require an explicit reason; the server still authorizes them. */
export async function scheduleMutationFetch(url: string, init: RequestInit, allowOverride = true) {
  let response = await selectedChurchFetch(url, init)
  if (response.status !== 409 || !allowOverride) return response
  const body = await response.clone().json()
  if (!body.override_allowed) return response
  const reason = window.prompt(`${body.error}\nPara prosseguir como admin, informe a justificativa:`)?.trim()
  if (!reason) return response
  response = await selectedChurchFetch(url, {
    ...init,
    body: JSON.stringify({ ...JSON.parse(String(init.body)), conflict_override_reason: reason }),
  })
  return response
}
