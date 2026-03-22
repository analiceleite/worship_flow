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

    const configuredBaseUrl = (process.env.APP_BASE_URL ?? '').trim().replace(/\/$/, '')
    const requestBaseUrl = new URL(request.url).origin.replace(/\/$/, '')
    const baseUrl = configuredBaseUrl || requestBaseUrl

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
      const rawMessage = (error.message ?? '').toLowerCase()
      const isRateLimited =
        rawMessage.includes('rate limit') ||
        rawMessage.includes('too many requests') ||
        rawMessage.includes('email rate limit exceeded')

      if (isRateLimited) {
        return NextResponse.json(
          {
            error:
              'Novo e-mail de recuperação temporariamente bloqueado. Aguarde cerca de 60 segundos e tente novamente.',
          },
          {
            status: 429,
            headers: {
              'Retry-After': '60',
            },
          },
        )
      }

      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar a solicitação.' }, { status: 500 })
  }
}
