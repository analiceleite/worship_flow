import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, authenticatePlatformAdmin } from '@/lib/auth-context'

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await authenticatePlatformAdmin()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const updates: Record<string, string> = {}

  if (body?.name !== undefined) updates.name = String(body.name).trim()
  if (body?.slug !== undefined) updates.slug = slugify(String(body.slug).trim())
  if (body?.status !== undefined) updates.status = String(body.status)
  if (body?.environment !== undefined) updates.environment = String(body.environment)
  if (body?.email_mode !== undefined) updates.email_mode = String(body.email_mode)
  if (body?.plan !== undefined) updates.plan = String(body.plan).trim() || 'free'

  if (updates.name !== undefined && !updates.name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 })
  if (updates.slug !== undefined && !updates.slug) return NextResponse.json({ error: 'Slug é obrigatório.' }, { status: 400 })
  if (updates.status !== undefined && !['active', 'inactive'].includes(updates.status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 })
  if (updates.environment !== undefined && !['production', 'demo', 'test'].includes(updates.environment)) return NextResponse.json({ error: 'Ambiente inválido.' }, { status: 400 })
  if (updates.email_mode !== undefined && !['real', 'disabled', 'test_recipient'].includes(updates.email_mode)) return NextResponse.json({ error: 'Modo de email inválido.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: current, error: currentError } = await admin
    .from('churches')
    .select('environment, email_mode')
    .eq('id', id)
    .maybeSingle()

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Igreja não encontrada.' }, { status: 404 })

  const nextEnvironment = updates.environment ?? current.environment
  const nextEmailMode = updates.email_mode ?? current.email_mode
  if (nextEnvironment !== 'production' && nextEmailMode === 'real') {
    return NextResponse.json({ error: 'Igrejas demo/teste não podem enviar emails reais.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('churches')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ church: data })
}
