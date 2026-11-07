import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { enableChurchSync, exchangeCodeForTokens, saveTokensForUser } from '@/lib/google-calendar/client'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const cookieStore = await cookies()
  const rawState = cookieStore.get('google_oauth_state')?.value
  let savedState: { nonce: string; userId: string; ministerId: string; churchId: string } | null = null
  try {
    const parsed = JSON.parse(rawState ?? '')
    if (typeof parsed.nonce === 'string' && typeof parsed.userId === 'string' &&
        typeof parsed.ministerId === 'string' && typeof parsed.churchId === 'string') savedState = parsed
  } catch {
    savedState = null
  }

  const redirectTo = (status: string) => {
    const query = new URLSearchParams({
      google_calendar: status,
      ...(savedState?.churchId ? { churchId: savedState.churchId } : {}),
    })
    const res = NextResponse.redirect(new URL(`/profile?${query.toString()}`, request.url))
    res.cookies.set('google_oauth_state', '', { maxAge: 0, path: '/' })
    res.headers.set('Cache-Control', 'no-store')
    res.headers.set('Referrer-Policy', 'no-referrer')
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return res
  }

  if (errorParam) return redirectTo('denied')
  if (!code || !state || state !== savedState?.nonce) return redirectTo('error')

  let context
  try {
    context = await getCurrentMinisterContext({ churchId: savedState!.churchId })
    if (context.userId !== savedState!.userId || context.ministerId !== savedState!.ministerId || context.isImpersonating) {
      return redirectTo('error')
    }
  } catch (error) {
    if (error instanceof AuthContextError) return redirectTo('error')
    throw error
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) return redirectTo('no_refresh_token')

    await saveTokensForUser(context.userId, tokens)
    await enableChurchSync(context.userId, context.churchId, context.ministerId)

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
