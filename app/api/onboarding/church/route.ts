import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImpersonatedChurchId } from '@/lib/auth-context'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { CHURCH_CONTEXT_COOKIE, churchPreferenceValue } from '@/lib/auth/context-selection'
import { ChurchCreationError, createChurchForVerifiedIdentity } from '@/lib/church-creation/server'
import { churchCreateSchema, churchCreationHttpError } from '@/lib/onboarding/rules'
import { publicChurchCreationEnabled } from '@/lib/onboarding/flags'

const noStore = { 'Cache-Control': 'no-store' }

// WF-38: the verified owner creates their church and becomes its first ADMIN in one call.
// The identity comes from the session; the server decides plan, environment and privileges.
export async function POST(request: Request) {
  try {
    if (!publicChurchCreationEnabled()) {
      return NextResponse.json({ error: 'Não disponível no momento.' }, { status: 404, headers: noStore })
    }
    const user = await getAuthenticatedIdentity()
    if (!user) return NextResponse.json({ error: 'Entre para criar sua igreja.' }, { status: 401, headers: noStore })
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403, headers: noStore })
    }
    if (await getImpersonatedChurchId()) {
      return NextResponse.json({ error: 'Encerre o contexto de suporte para criar uma igreja.' }, { status: 403, headers: noStore })
    }
    if (!user.email_confirmed_at) {
      return NextResponse.json({ error: 'Confirme seu e-mail antes de criar a igreja.' }, { status: 403, headers: noStore })
    }
    const body = churchCreateSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Revise o nome da igreja e tente novamente.' }, { status: 400, headers: noStore })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('name').eq('user_id', user.id).maybeSingle()
    const metadataName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : ''
    const adminName = (profile?.name || metadataName || 'Responsável').trim().slice(0, 200)

    const result = await createChurchForVerifiedIdentity({
      creatorUserId: user.id,
      idempotencyKey: body.data.idempotencyKey,
      churchName: body.data.name,
      adminName,
    })

    const store = await cookies()
    store.set(CHURCH_CONTEXT_COOKIE, churchPreferenceValue(user.id, result.churchId), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    })
    return NextResponse.json(
      { church: { id: result.churchId }, status: result.status },
      { status: result.status === 'created' ? 201 : 200, headers: noStore },
    )
  } catch (error) {
    if (error instanceof ChurchCreationError) {
      const { status, message } = churchCreationHttpError(error.code)
      return NextResponse.json({ error: message }, { status, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível criar a igreja agora.' }, { status: 503, headers: noStore })
  }
}
