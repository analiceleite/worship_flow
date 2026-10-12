import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { exchangeCodeForTokens, saveTokensForMinister } from '@/lib/google-calendar/client'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const cookieStore = await cookies()
  const expectedState = cookieStore.get('google_oauth_state')?.value

  const redirectTo = (status: string) => {
    const res = NextResponse.redirect(new URL(`/profile?google_calendar=${status}`, request.url))
    res.cookies.set('google_oauth_state', '', { maxAge: 0, path: '/' })
    return res
  }

  if (errorParam) return redirectTo('denied')
  if (!code || !state || state !== expectedState) return redirectTo('error')

  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) return redirectTo('error')
    throw error
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) return redirectTo('no_refresh_token')

    await saveTokensForMinister(context.ministerId, context.churchId, tokens)

    // Important: this must be awaited, not fire-and-forget — Vercel serverless functions can
    // freeze/kill background work the instant the response is sent, unlike a long-running server.
    try {
      await reconcileMinisterCalendar(context.ministerId)
    } catch (syncError) {
      console.error('Initial Google Calendar sync failed:', syncError)
    }

    return redirectTo('connected')
  } catch (error) {
    console.error('Error completing Google Calendar OAuth:', error)
    return redirectTo('error')
  }
}
