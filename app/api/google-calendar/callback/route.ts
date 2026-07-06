import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return redirectTo('error')

  const admin = createAdminClient()
  const { data: minister } = await admin.from('ministers').select('id').eq('user_id', user.id).single()
  if (!minister) return redirectTo('error')

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) return redirectTo('no_refresh_token')

    await saveTokensForMinister(minister.id, tokens)

    // Important: this must be awaited, not fire-and-forget — Vercel serverless functions can
    // freeze/kill background work the instant the response is sent, unlike a long-running server.
    try {
      await reconcileMinisterCalendar(minister.id)
    } catch (syncError) {
      console.error('Initial Google Calendar sync failed:', syncError)
    }

    return redirectTo('connected')
  } catch (error) {
    console.error('Error completing Google Calendar OAuth:', error)
    return redirectTo('error')
  }
}
