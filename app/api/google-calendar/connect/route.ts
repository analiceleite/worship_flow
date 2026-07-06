import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUrl } from '@/lib/google-calendar/client'
import { ROUTES } from '@/lib/routes'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL(ROUTES.AUTH_LOGIN, request.url))
  }

  const state = randomUUID()
  const response = NextResponse.redirect(getAuthUrl(state))
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}
