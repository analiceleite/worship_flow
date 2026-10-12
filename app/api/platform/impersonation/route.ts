import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  AuthContextError,
  authenticatePlatformAdmin,
  getImpersonatedChurchId,
  startChurchImpersonation,
  stopChurchImpersonation,
} from '@/lib/auth-context'

async function audit(action: string, userId: string, churchId: string | null, metadata?: Record<string, unknown>) {
  if (!churchId) return
  const admin = createAdminClient()
  await admin.from('platform_impersonation_audit').insert({
    platform_user_id: userId,
    church_id: churchId,
    action,
    metadata: metadata ?? {},
  })
}

export async function GET() {
  try {
    const platform = await authenticatePlatformAdmin()
    const churchId = await getImpersonatedChurchId()
    if (!churchId) return NextResponse.json({ impersonating: false, church: null })

    const admin = createAdminClient()
    const { data: church } = await admin
      .from('churches')
      .select('id, name, slug')
      .eq('id', churchId)
      .maybeSingle()

    return NextResponse.json({ impersonating: Boolean(church), church: church ?? null, platformUserId: platform.userId })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ impersonating: false, church: null }, { status: error.status })
    }
    throw error
  }
}

export async function POST(request: Request) {
  let platform
  try {
    platform = await authenticatePlatformAdmin()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const body = await request.json().catch(() => ({}))
  const churchId = String(body?.church_id ?? '').trim()
  if (!churchId) return NextResponse.json({ error: 'Igreja é obrigatória.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: church, error } = await admin
    .from('churches')
    .select('id, name, slug')
    .eq('id', churchId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!church) return NextResponse.json({ error: 'Igreja não encontrada.' }, { status: 404 })

  await startChurchImpersonation(church.id)
  await audit('start', platform.userId, church.id, { church_slug: church.slug })
  return NextResponse.json({ impersonating: true, church })
}

export async function DELETE() {
  let platform
  try {
    platform = await authenticatePlatformAdmin()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const churchId = await getImpersonatedChurchId()
  await stopChurchImpersonation()
  await audit('stop', platform.userId, churchId)
  return NextResponse.json({ impersonating: false })
}
