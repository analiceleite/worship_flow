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

    const baseUrl = (process.env.APP_BASE_URL ?? '').trim().replace(/\/$/, '')

    if (!baseUrl) {
      return NextResponse.json(
        { error: 'APP_BASE_URL não configurada no ambiente.' },
        { status: 500 },
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}${ROUTES.AUTH_SET_PASSWORD}`,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar a solicitação.' }, { status: 500 })
  }
}
