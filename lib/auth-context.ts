import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { CurrentMinisterContext, Minister, PlatformAdminContext } from '@/lib/types'

export const IMPERSONATED_CHURCH_COOKIE = 'wf_impersonated_church_id'

type AuthContextOptions = {
  requireAdmin?: boolean
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
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
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

  const { data: minister, error: ministerError } = await supabase
    .from('ministers')
    .select('id, church_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (ministerError || (!minister?.church_id && !platformAdmin)) {
    throw new AuthContextError('Ministro não encontrado para o usuário autenticado.', 403)
  }

  const isImpersonating = Boolean(platformAdmin && impersonatedChurchId)
  const role = isImpersonating ? 'admin' : minister!.role as Minister['role']
  const context: CurrentMinisterContext = {
    userId: user.id,
    ministerId: minister?.id ?? user.id,
    churchId: isImpersonating ? impersonatedChurchId! : minister!.church_id,
    role,
    isAdmin: role === 'admin',
    isImpersonating,
    impersonatedChurchId: isImpersonating ? impersonatedChurchId : null,
  }

  if (options.requireAdmin && !context.isAdmin) {
    throw new AuthContextError('Acesso restrito a administradores da igreja.', 403)
  }

  return context
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
