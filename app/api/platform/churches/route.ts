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

function validateEmailMode(environment: string, emailMode: string) {
  return environment === 'production' || emailMode !== 'real'
}

export async function GET() {
  try {
    await authenticatePlatformAdmin()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('churches')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ churches: data ?? [] })
}

export async function POST(request: Request) {
  try {
    await authenticatePlatformAdmin()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  const slug = slugify(String(body?.slug ?? name).trim())
  const status = String(body?.status ?? 'active')
  const environment = String(body?.environment ?? 'production')
  const emailMode = String(body?.email_mode ?? 'real')
  const plan = String(body?.plan ?? 'free').trim() || 'free'

  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 })
  if (!slug) return NextResponse.json({ error: 'Slug é obrigatório.' }, { status: 400 })
  if (!['active', 'inactive'].includes(status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 })
  if (!['production', 'demo', 'test'].includes(environment)) return NextResponse.json({ error: 'Ambiente inválido.' }, { status: 400 })
  if (!['real', 'disabled', 'test_recipient'].includes(emailMode)) return NextResponse.json({ error: 'Modo de email inválido.' }, { status: 400 })
  if (!validateEmailMode(environment, emailMode)) {
    return NextResponse.json({ error: 'Igrejas demo/teste não podem enviar emails reais.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('churches')
    .insert({ name, slug, status, environment, email_mode: emailMode, plan })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ church: data }, { status: 201 })
}
