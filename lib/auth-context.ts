import { cookies, headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { Church, CurrentMinisterContext, Minister, PlatformAdminContext } from '@/lib/types'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { resolveMembership, type MembershipCandidate } from '@/lib/auth/membership'
import { CHURCH_CONTEXT_COOKIE, CHURCH_CONTEXT_HEADER, isChurchId, readChurchPreference } from '@/lib/auth/context-selection'

export const IMPERSONATED_CHURCH_COOKIE = 'wf_impersonated_church_id'
export { CHURCH_CONTEXT_HEADER } from '@/lib/auth/context-selection'

type AuthContextOptions = {
  requireAdmin?: boolean
  churchId?: string | null
}

export class AuthContextError extends Error {
  status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'AuthContextError'
    this.status = status
  }
}

export async function getCurrentMinisterContext(
  options: AuthContextOptions = {},
): Promise<CurrentMinisterContext> {
  const user = await getAuthenticatedIdentity()
  if (!user) {
    throw new AuthContextError('Usuário não autenticado.', 401)
  }

  const admin = createAdminClient()
  const impersonatedChurchId = await getImpersonatedChurchId()
  const { data: platformAdmin } = impersonatedChurchId
    ? await admin
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }

  const isImpersonating = Boolean(platformAdmin && impersonatedChurchId)
  const requestHeaders = await headers()
  const requestedChurchId = options.churchId ?? requestHeaders.get(CHURCH_CONTEXT_HEADER)
  if (requestedChurchId !== null && !isChurchId(requestedChurchId)) {
    throw new AuthContextError('Identificador da igreja inválido.', 400)
  }

  let membership: MembershipCandidate | undefined
  let accessibleChurchCount = 0
  if (isImpersonating) {
    if (requestedChurchId && requestedChurchId !== impersonatedChurchId) {
      throw new AuthContextError('A igreja solicitada difere do contexto de suporte.', 409)
    }
    const { data: church, error } = await admin.from('churches').select('status')
      .eq('id', impersonatedChurchId!).maybeSingle()
    if (error) throw new AuthContextError('Não foi possível verificar a igreja.', 503)
    if (church?.status !== 'active') throw new AuthContextError('Igreja indisponível.', 403)
  } else {
    const cookieStore = await cookies()
    const preference = readChurchPreference(cookieStore.get(CHURCH_CONTEXT_COOKIE)?.value, user.id)
    const [memberships, preferenceResult] = await Promise.all([
      getOwnMemberships(user.id),
      !preference && !requestedChurchId
        ? admin.from('user_profiles').select('last_church_id').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (preferenceResult.error) throw new AuthContextError('Não foi possível consultar sua preferência de igreja.', 503)
    const preferredChurchId = preference ?? preferenceResult.data?.last_church_id ?? null
    const ownMemberships = memberships as Awaited<ReturnType<typeof getOwnMemberships>>
    const resolution = resolveMembership(ownMemberships, requestedChurchId, preferredChurchId)
    accessibleChurchCount = ownMemberships.filter(item => item.access_state === 'active' && item.church_status === 'active').length
    if (resolution.kind === 'selection_required') {
      throw new AuthContextError('Selecione uma igreja para continuar.', 409)
    }
    if (resolution.kind === 'unavailable') {
      throw new AuthContextError('Você não possui acesso ativo à igreja solicitada.', 403)
    }
    membership = resolution.membership
  }
  const role = isImpersonating ? 'admin' : membership!.role
  const context: CurrentMinisterContext = {
    userId: user.id,
    ministerId: membership?.id ?? user.id,
    churchId: isImpersonating ? impersonatedChurchId! : membership!.church_id,
    role,
    isAdmin: role === 'admin',
    isImpersonating,
    accessibleChurchCount,
    impersonatedChurchId: isImpersonating ? impersonatedChurchId : null,
  }

  if (options.requireAdmin && !context.isAdmin) {
    throw new AuthContextError('Acesso restrito a administradores da igreja.', 403)
  }

  return context
}

// Call only with the identity returned by auth.getUser(), never an HTTP user ID.
export async function getOwnMemberships(userId: string): Promise<Array<MembershipCandidate & { church_name: string }>> {
  const admin = createAdminClient()
  const { data: memberships, error } = await admin.from('ministers')
    .select('id, church_id, role, access_state').eq('user_id', userId)
  if (error) throw new AuthContextError('Não foi possível consultar seus vínculos.', 503)
  if (!memberships?.length) return []
  const membershipRows = memberships as Array<Pick<Minister, 'id' | 'church_id' | 'role' | 'access_state'>>
  const { data: churches, error: churchError } = await admin.from('churches')
    .select('id, name, status').in('id', [...new Set(membershipRows.map(item => item.church_id))])
  if (churchError) throw new AuthContextError('Não foi possível consultar suas igrejas.', 503)
  const churchRows = (churches ?? []) as Array<Pick<Church, 'id' | 'name' | 'status'>>
  const byId = new Map(churchRows.map(church => [church.id, church]))
  return membershipRows.flatMap(item => {
    const church = byId.get(item.church_id)
    if (!church) return []
    return [{
      id: item.id, church_id: item.church_id, role: item.role as Minister['role'],
      access_state: item.access_state, church_status: church.status, church_name: church.name,
    }]
  })
}

export async function authenticatePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new AuthContextError('Usuário não autenticado.', 401)
  }

  const admin = createAdminClient()
  const { data: platformAdmin, error: platformAdminError } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (platformAdminError || !platformAdmin) {
    throw new AuthContextError('Acesso restrito a administradores da plataforma.', 403)
  }

  return { userId: user.id }
}

export async function getImpersonatedChurchId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(IMPERSONATED_CHURCH_COOKIE)?.value ?? null
}

export async function startChurchImpersonation(churchId: string) {
  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATED_CHURCH_COOKIE, churchId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

export async function stopChurchImpersonation() {
  const cookieStore = await cookies()
  cookieStore.delete(IMPERSONATED_CHURCH_COOKIE)
}
