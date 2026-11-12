import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ROUTES } from '@/lib/routes'
import { serverSupabaseFetch } from '@/lib/supabase/server-fetch'
import { canMediaAccessSchedule } from '@/lib/schedule/access'
import { resolveMembership, type MembershipCandidate } from '@/lib/auth/membership'
import { CHURCH_CONTEXT_COOKIE, isChurchId, readChurchPreference } from '@/lib/auth/context-selection'

function matchesPath(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: serverSupabaseFetch },
      auth: { flowType: 'implicit' },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: cookies => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  const isRecoveryRoute = matchesPath(pathname, ROUTES.AUTH_RESET)
  const isInviteRoute = matchesPath(pathname, ROUTES.AUTH_INVITE)
  const publicRoutes = [ROUTES.AUTH_LOGIN, ROUTES.AUTH_SET_PASSWORD, ROUTES.AUTH_FORGOT_PASSWORD, ROUTES.AUTH_RESET, ROUTES.AUTH_INVITE, ROUTES.AUTH_CRIAR_IGREJA]
  const isPublicRoute = publicRoutes.some(route => matchesPath(pathname, route))
  const isSelectionRoute = pathname === ROUTES.AUTH_SELECT_CHURCH

  function redirect(destination: string) {
    const next = NextResponse.redirect(new URL(destination, request.url))
    // Redirects must keep cookies refreshed by Supabase, not revive an old session.
    response.cookies.getAll().forEach(cookie => next.cookies.set(cookie))
    next.headers.set('Cache-Control', 'no-store')
    return next
  }

  if (user || isRecoveryRoute || isSelectionRoute || isInviteRoute) response.headers.set('Cache-Control', 'no-store')
  if (isRecoveryRoute || isSelectionRoute || isInviteRoute) {
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  if (!user) return isPublicRoute ? response : redirect(ROUTES.AUTH_LOGIN)
  // Selection, recovery and invitation pages must work without an operational
  // membership. Merely possessing ?code=... is not authentication or a bypass
  // for protected pages.
  // The owner-onboarding page works before any membership exists; its APIs enforce the rules.
  if (matchesPath(pathname, ROUTES.AUTH_CRIAR_IGREJA)) return response
  if (isSelectionRoute || isRecoveryRoute || isInviteRoute || pathname === ROUTES.AUTH_SET_PASSWORD || pathname === ROUTES.AUTH_FORGOT_PASSWORD) return response
  if (matchesPath(pathname, '/platform')) return response // APIs enforce platform permissions.

  const cookiePreference = readChurchPreference(request.cookies.get(CHURCH_CONTEXT_COOKIE)?.value, user.id)
  const requestedChurch = request.nextUrl.searchParams.get('churchId')
  if (requestedChurch !== null && !isChurchId(requestedChurch)) return redirect(ROUTES.AUTH_SELECT_CHURCH)
  const [memberResult, preferenceResult] = await Promise.all([
    supabase.from('ministers').select('id, church_id, role, access_state').eq('user_id', user.id),
    cookiePreference || requestedChurch ? Promise.resolve({ data: null, error: null })
      : supabase.from('user_profiles').select('last_church_id').eq('user_id', user.id).maybeSingle(),
  ])
  if (memberResult.error || preferenceResult.error || !memberResult.data?.length) return redirect(ROUTES.AUTH_SELECT_CHURCH)
  const members = memberResult.data as Array<Omit<MembershipCandidate, 'church_status'>>
  const { data: churches, error } = await supabase.from('churches').select('id, status')
    .in('id', [...new Set(members.map(member => member.church_id))])
  if (error) return redirect(ROUTES.AUTH_SELECT_CHURCH)
  const churchRows = (churches ?? []) as Array<{ id: string; status: 'active' | 'inactive' }>
  const byId = new Map(churchRows.map(church => [church.id, church.status]))
  const resolution = resolveMembership(members.map(member => ({
    ...member, church_status: byId.get(member.church_id) ?? 'inactive',
  })), requestedChurch, cookiePreference ?? preferenceResult.data?.last_church_id)
  if (resolution.kind !== 'selected') return redirect(ROUTES.AUTH_SELECT_CHURCH)
  const role = resolution.membership.role
  const home = role === 'admin' ? ROUTES.SCHEDULE_ADMIN_DASHBOARD : role === 'midia' ? ROUTES.REPERTOIRE : ROUTES.SONGS
  if (isPublicRoute || pathname === ROUTES.HOME) return redirect(home)
  if ([ROUTES.USERS, ROUTES.SCHEDULE_ADMIN].some(route => matchesPath(pathname, route)) && role !== 'admin') return redirect(ROUTES.HOME)
  if (role === 'midia' && !(
    canMediaAccessSchedule(pathname) || matchesPath(pathname, ROUTES.REPERTOIRE) || matchesPath(pathname, ROUTES.PROFILE)
  )) return redirect(ROUTES.REPERTOIRE)
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|js|css|map|txt|xml|webmanifest)$).*)',
  ],
}
