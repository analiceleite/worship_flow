'use client'

import { createClient } from '@/lib/supabase/client'
import type { Church, CurrentMinisterContext, Minister } from '@/lib/types'
import { ROUTES } from '@/lib/routes'
import { CHURCH_CONTEXT_HEADER, isChurchId } from '@/lib/auth/context-selection'

export type ChurchContextResponse = {
  context: CurrentMinisterContext
  church: Pick<Church, 'id' | 'name' | 'slug' | 'environment'> | null
  viewer: { name: string; avatar_url: string | null } | null
}

export async function loadChurchContext(churchId?: string): Promise<ChurchContextResponse> {
  const startedAt = `${window.location.pathname}${window.location.search}`
  const requestedChurch = churchId ?? new URLSearchParams(window.location.search).get('churchId')
  if (requestedChurch !== null && !isChurchId(requestedChurch)) throw new Error('Identificador da igreja inválido.')
  const response = await fetch('/api/context', {
    cache: 'no-store', headers: requestedChurch ? { [CHURCH_CONTEXT_HEADER]: requestedChurch } : undefined,
  })
  if (response.status === 401 || response.status === 403 || response.status === 409) {
    // A response from an abandoned page must not navigate away from a newer
    // selection/recovery page or overwrite its freshly selected context.
    if (`${window.location.pathname}${window.location.search}` === startedAt) {
      window.location.replace(response.status === 401 ? ROUTES.AUTH_LOGIN : ROUTES.AUTH_SELECT_CHURCH)
    }
    throw new Error('Selecione uma igreja com acesso ativo para continuar.')
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Não foi possível identificar a igreja atual.')
  return result
}

export async function loadSelectedMinister(context: CurrentMinisterContext): Promise<Minister> {
  const { data, error } = await createClient().from('ministers').select('*')
    .eq('id', context.ministerId).eq('church_id', context.churchId).maybeSingle()
  if (error) throw new Error('Não foi possível consultar sua participação nesta igreja.')
  if (!data) throw new Error(context.isImpersonating
    ? 'A consulta desta tela no contexto de suporte ainda está indisponível.'
    : 'Sua participação nesta igreja está indisponível.')
  return data as Minister
}

// Callers pass the church captured when the operation/form was opened. Never
// infer a mutation's tenant from a mutable cookie after another tab changes it.
export function churchFetch(churchId: string, path: string, init: RequestInit = {}) {
  if (!isChurchId(churchId) || !path.startsWith('/api/')) throw new Error('Contexto da solicitação inválido.')
  const headers = new Headers(init.headers)
  headers.set(CHURCH_CONTEXT_HEADER, churchId)
  return fetch(path, { ...init, cache: 'no-store', headers })
}

/** Resolve the server-validated selection immediately before an operation and
 * pin it on that request. Use churchFetch directly when a screen captured its
 * church ID, especially for writes. */
export async function selectedChurchFetch(path: string, init: RequestInit = {}) {
  const { context } = await loadChurchContext()
  return churchFetch(context.churchId, path, init)
}
