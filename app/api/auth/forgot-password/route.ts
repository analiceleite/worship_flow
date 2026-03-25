import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

type ForgotPasswordPayload = {
  email?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ForgotPasswordPayload
    const email = body.email?.trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 })
    }

    // Pega a base URL (sem trailing slash)
    const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '')

    if (!baseUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL não configurada.' },
        { status: 500 },
      )
    }

    const supabase = await createClient()

    // Envia o link com PKCE (padrão moderno, funciona em mobile)
    // O Supabase automáticamente gera ?code=... em vez de #hash
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}${ROUTES.AUTH_SET_PASSWORD}`,
    })

    if (error) {
      const message = (error.message ?? '').toLowerCase()

      if (message.includes('rate limit') || message.includes('too many requests')) {
        return NextResponse.json(
          { error: 'Aguarde 60 segundos antes de solicitar novo e-mail.' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }

      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 })
  }
}