import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ROUTES } from '@/lib/routes'
import { serverSupabaseFetch } from '@/lib/supabase/server-fetch'
import { canMediaAccessSchedule } from '@/lib/schedule/access'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const isAuthFlow = request.nextUrl.searchParams.has('code')

  console.log('[middleware] isAuthFlow:', isAuthFlow)

  if (isAuthFlow) {
    console.log('[middleware] auth flow detected, will process PKCE and set cookies')
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: serverSupabaseFetch },
      // cast to any to satisfy differing cookie method typings in @supabase/ssr
      cookies: ({
        // read cookie value from incoming request
        get: (name: any) => {
          const v = request.cookies.get(name)?.value
          console.log('[middleware] cookie.get', name, v ? 'FOUND' : 'MISS')
          return v
        },
        // return all cookies as expected by @supabase/ssr
        getAll: () => {
          try {
            // NextRequest.cookies has a .getAll when running in middleware
            // fallback to building an array if not available
            // each item shape: { name, value }
            // @ts-ignore
            const all = request.cookies.getAll ? request.cookies.getAll() : []
            const mapped = all.map((c: any) => ({ name: c.name, value: c.value }))
            console.log('[middleware] cookie.getAll count=', mapped.length)
            return mapped
          } catch {
            return []
          }
        },
        // apply all cookies set by Supabase to the NextResponse
        setAll: (cookiesToSet: Array<{ name: string; value: string; options?: any }>) => {
          try {
            console.log('[middleware] setting cookies count=', cookiesToSet.length)
            cookiesToSet.forEach(({ name, value, options }) => {
              console.log('[middleware] set cookie', name)
              // response.cookies.set has the signature (name, value, options)
              // @ts-ignore
              response.cookies.set(name, value, options || {})
            })
          } catch {
            // best-effort: ignore failures
          }
        },
        // convenience single-set/remove (not always used)
        set: (name: string, value: string, options?: any) => {
          try {
            console.log('[middleware] set single cookie', name)
            // @ts-ignore
            response.cookies.set(name, value, options || {})
          } catch {
            // ignore
          }
        },
        remove: (name: string) => {
          try {
            console.log('[middleware] remove cookie', name)
            // @ts-ignore
            response.cookies.delete ? response.cookies.delete(name) : response.cookies.set(name, '', { maxAge: 0 })
          } catch {
            // ignore
          }
        },
      } as any)
    }
  )

  console.log('[middleware] supabase client created')

  // 🔑 CRÍTICO: Processa o ?code=... do PKCE
  try {
    const { data: sessionData, error: getSessionError } = await supabase.auth.getSession()
    console.log('[middleware] getSession error=', getSessionError ? getSessionError.message : null)
    console.log('[middleware] getSession session=', !!sessionData?.session)
  } catch (e) {
    console.log('[middleware] getSession threw', e)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  console.log('[middleware] getUser user=', !!user)

  const publicRoutes = [
    ROUTES.AUTH_LOGIN,
    ROUTES.AUTH_SET_PASSWORD,
    ROUTES.AUTH_FORGOT_PASSWORD,
    ROUTES.AUTH_RESET,
  ]
  const isPublicRoute = publicRoutes.some(route =>
    request.nextUrl.pathname.startsWith(route)
  )
  const isRecoveryRoute = request.nextUrl.pathname === ROUTES.AUTH_RESET || request.nextUrl.pathname.startsWith(`${ROUTES.AUTH_RESET}/`)
  if (isRecoveryRoute) {
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  // Se não está autenticado e tenta acessar rota protegida
  if (!user && !isPublicRoute && !isAuthFlow) {
    return NextResponse.redirect(new URL(ROUTES.AUTH_LOGIN, request.url))
  }

  // Se está autenticado
  if (user && !isPublicRoute) {
    const isPlatformRoute = request.nextUrl.pathname.startsWith('/platform')
    if (isPlatformRoute) return response

    const { data: minister, error } = await supabase
      .from('ministers')
      .select('role, is_active')
      .eq('user_id', user.id)
      .single()

    // Se não encontrou registro do ministro
    if (error || !minister) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL(ROUTES.AUTH_LOGIN, request.url))
    }

    // Se a conta não está ativa, deixa ir para SET_PASSWORD
    // (não redireciona aqui, deixa a página handle)

    // Admin-only routes
    const adminRoutes = [ROUTES.USERS, ROUTES.SCHEDULE_ADMIN]
    const isAdminRoute = adminRoutes.some(route =>
      request.nextUrl.pathname.startsWith(route)
    )

    if (isAdminRoute && minister.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url))
    }

    if (request.nextUrl.pathname === ROUTES.HOME) {
      const target = minister.role === 'admin'
        ? ROUTES.SCHEDULE_ADMIN_DASHBOARD
        : minister.role === 'midia'
          ? ROUTES.REPERTOIRE
          : ROUTES.SONGS
      return NextResponse.redirect(new URL(target, request.url))
    }

    // Mídia consulta a escala, mas não sua árvore administrativa.
    if (minister.role === 'midia') {
      const allowed =
        canMediaAccessSchedule(request.nextUrl.pathname) ||
        request.nextUrl.pathname.startsWith(ROUTES.REPERTOIRE) ||
        request.nextUrl.pathname.startsWith(ROUTES.PROFILE) ||
        isPublicRoute
      if (!allowed) return NextResponse.redirect(new URL(ROUTES.REPERTOIRE, request.url))
    }
  }

  // Se está autenticado e tenta acessar login/forgot-password, redireciona para home
  if (user && isPublicRoute && request.nextUrl.pathname !== ROUTES.AUTH_SET_PASSWORD && !isRecoveryRoute && !isAuthFlow) {
    const { data: minister } = await supabase
      .from('ministers')
      .select('is_active, role')
      .eq('user_id', user.id)
      .single()

    if (minister?.is_active) {
      const target = minister.role === 'admin'
        ? ROUTES.SCHEDULE_ADMIN_DASHBOARD
        : minister.role === 'midia'
          ? ROUTES.REPERTOIRE
          : ROUTES.SONGS
      return NextResponse.redirect(new URL(target, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|js|css|map|txt|xml|webmanifest)$).*)',
  ],
}
