import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-calendar/client'
import { ROUTES } from '@/lib/routes'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { cookies } from 'next/headers'
import { z } from 'zod'

export async function GET(request: Request) {
  const churchId = new URL(request.url).searchParams.get('churchId')
  if (!z.string().uuid().safeParse(churchId).success) {
    return NextResponse.redirect(new URL(ROUTES.AUTH_SELECT_CHURCH, request.url))
  }
  let context
  try {
    context = await getCurrentMinisterContext({ churchId })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.redirect(new URL(error.status === 401 ? ROUTES.AUTH_LOGIN : ROUTES.AUTH_SELECT_CHURCH, request.url))
    }
    throw error
  }
  if (context.isImpersonating) {
    return NextResponse.redirect(new URL(`/profile?churchId=${context.churchId}&google_calendar=error`, request.url))
  }

  const nonce = randomUUID()
  const cookiePayload = JSON.stringify({ nonce, userId: context.userId, ministerId: context.ministerId, churchId: context.churchId })
  const response = NextResponse.redirect(getAuthUrl(nonce))
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  const cookieStore = await cookies()
  cookieStore.set('google_oauth_state', cookiePayload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}
