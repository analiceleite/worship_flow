import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || ROUTES.AUTH_SET_PASSWORD

  const baseUrl = requestUrl.origin
  const safeNext = next.startsWith('/') ? next : ROUTES.AUTH_SET_PASSWORD

  if (!code) {
    return NextResponse.redirect(
      new URL(`${ROUTES.AUTH_FORGOT_PASSWORD}?error=missing_code`, baseUrl),
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      new URL(`${ROUTES.AUTH_FORGOT_PASSWORD}?error=expired_or_invalid_link`, baseUrl),
    )
  }

  return NextResponse.redirect(new URL(safeNext, baseUrl))
}
