import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ROUTES } from '@/lib/routes'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: any) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // 🔑 CRÍTICO: Processa automaticamente o ?code=... do PKCE
  // Isto faz o exchange do código por sessão válida
  await supabase.auth.getSession()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Public routes that don't require authentication
  const publicRoutes = [ROUTES.AUTH_LOGIN, ROUTES.AUTH_SET_PASSWORD, ROUTES.AUTH_FORGOT_PASSWORD]
  const isPublicRoute = publicRoutes.some(route =>
    request.nextUrl.pathname.startsWith(route)
  )

  // If not authenticated and trying to access protected route
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL(ROUTES.AUTH_LOGIN, request.url))
  }

  // If authenticated, check minister record and role
  if (user && !isPublicRoute) {
    const { data: minister, error } = await supabase
      .from('ministers')
      .select('role, is_active')
      .eq('user_id', user.id)
      .single()

    // If minister record not found, redirect to login
    if (error || !minister) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL(ROUTES.AUTH_LOGIN, request.url))
    }

    // If account not activated, redirect to set password
    if (!minister.is_active && request.nextUrl.pathname !== ROUTES.AUTH_SET_PASSWORD) {
      return NextResponse.redirect(new URL(ROUTES.AUTH_SET_PASSWORD, request.url))
    }

    // Admin-only routes
    const adminRoutes = [ROUTES.USERS, ROUTES.SCHEDULE_ADMIN]
    const isAdminRoute = adminRoutes.some(route =>
      request.nextUrl.pathname.startsWith(route)
    )

    if (isAdminRoute && minister.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url))
    }

    if (request.nextUrl.pathname === ROUTES.HOME) {
      const target = minister.role === 'admin' ? ROUTES.SCHEDULE_ADMIN_DASHBOARD : ROUTES.SONGS
      return NextResponse.redirect(new URL(target, request.url))
    }

    // 'midia' users: only allow viewing the repertório page
    if (minister.role === 'midia') {
      const allowed = request.nextUrl.pathname.startsWith(ROUTES.REPERTOIRE) || isPublicRoute
      if (!allowed) return NextResponse.redirect(new URL(ROUTES.REPERTOIRE, request.url))
    }
  }

  // If authenticated and trying to access auth pages, redirect to home
  if (user && isPublicRoute) {
    const { data: minister } = await supabase
      .from('ministers')
      .select('is_active, role')
      .eq('user_id', user.id)
      .single()

    if (minister?.is_active) {
      const target = minister.role === 'admin' ? ROUTES.SCHEDULE_ADMIN_DASHBOARD : ROUTES.SONGS
      return NextResponse.redirect(new URL(target, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\.(?:svg|png|jpg|jpeg|gif|webp|js|css|map|txt|xml|webmanifest)$).*)',
  ],
}