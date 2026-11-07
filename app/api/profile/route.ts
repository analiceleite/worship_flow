import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { getImpersonatedChurchId } from '@/lib/auth-context'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { createAdminClient } from '@/lib/supabase/admin'

const profileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
}).strict().refine(body => Object.keys(body).length > 0)

export async function GET() {
  const user = await getAuthenticatedIdentity()
  if (!user) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 })
  const { data, error } = await createAdminClient().from('user_profiles')
    .select('user_id, name, avatar_url').eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível consultar seu perfil.' }, { status: 503 })
  return NextResponse.json({ profile: data }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedIdentity()
  if (!user) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 })
  if (await getImpersonatedChurchId()) {
    return NextResponse.json({ error: 'Encerre o contexto de suporte para alterar seu perfil pessoal.' }, { status: 403 })
  }
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
  }
  const body = profileSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Informe um nome entre 1 e 200 caracteres.' }, { status: 400 })
  const { data, error } = await createAdminClient().from('user_profiles')
    .update({ ...body.data, updated_at: new Date().toISOString() })
    .eq('user_id', user.id).select('user_id, name, avatar_url').maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível salvar seu perfil.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })
  return NextResponse.json({ profile: data }, { headers: { 'Cache-Control': 'no-store' } })
}
