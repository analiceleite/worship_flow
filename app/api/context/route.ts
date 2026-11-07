import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext, getOwnMemberships, getImpersonatedChurchId } from '@/lib/auth-context'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { resolveMembership } from '@/lib/auth/membership'
import { CHURCH_CONTEXT_COOKIE, churchPreferenceValue } from '@/lib/auth/context-selection'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { ROUTES } from '@/lib/routes'

const selectionSchema = z.object({ churchId: z.string().uuid() }).strict()
const noStore = { 'Cache-Control': 'no-store' }

export async function GET() {
  try {
    const context = await getCurrentMinisterContext()
    const admin = createAdminClient()
    const [churchResult, profileResult] = await Promise.all([
      admin.from('churches').select('id, name, slug, environment').eq('id', context.churchId).maybeSingle(),
      admin.from('user_profiles').select('name, avatar_url').eq('user_id', context.userId).maybeSingle(),
    ])
    if (churchResult.error || profileResult.error) {
      return NextResponse.json({ error: 'Não foi possível consultar o contexto atual.' }, { status: 503, headers: noStore })
    }
    return NextResponse.json({ context, church: churchResult.data ?? null, viewer: profileResult.data ?? null }, { headers: noStore })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível consultar o contexto atual.' }, { status: 503, headers: noStore })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedIdentity()
    if (!user) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401, headers: noStore })
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403, headers: noStore })
    }
    if (await getImpersonatedChurchId()) {
      return NextResponse.json({ error: 'Encerre o contexto de suporte antes de selecionar sua igreja.' }, { status: 409, headers: noStore })
    }
    const parsed = selectionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Selecione uma igreja válida.' }, { status: 400, headers: noStore })
    const resolution = resolveMembership(await getOwnMemberships(user.id), parsed.data.churchId)
    if (resolution.kind !== 'selected') {
      return NextResponse.json({ error: 'Você não possui acesso ativo a essa igreja.' }, { status: 403, headers: noStore })
    }
    const membership = resolution.membership
    const { data, error } = await createAdminClient().from('user_profiles')
      .update({ last_church_id: membership.church_id, updated_at: new Date().toISOString() })
      .eq('user_id', user.id).select('user_id').maybeSingle()
    if (error || !data) {
      return NextResponse.json({ error: 'Não foi possível salvar sua seleção. Tente novamente.' }, { status: 503, headers: noStore })
    }
    const store = await cookies()
    store.set(CHURCH_CONTEXT_COOKIE, churchPreferenceValue(user.id, membership.church_id), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    })
    return NextResponse.json({
      churchId: membership.church_id,
      redirectTo: membership.role === 'admin' ? ROUTES.USERS : membership.role === 'midia' ? ROUTES.REPERTOIRE : ROUTES.SONGS,
    }, { headers: noStore })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível selecionar a igreja.' }, { status: 503, headers: noStore })
  }
}
