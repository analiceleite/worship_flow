import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Public routes that don't require authentication
  const publicRoutes = ['/auth/login', '/auth/set-password']
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname.startsWith(route)
  )

  // If not authenticated and trying to access protected route
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
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
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // If account not activated, redirect to set password
    if (!minister.is_active && request.nextUrl.pathname !== '/auth/set-password') {
      return NextResponse.redirect(new URL('/auth/set-password', request.url))
    }

    // Admin-only routes
    const adminRoutes = ['/ministros']
    const isAdminRoute = adminRoutes.some(route => 
      request.nextUrl.pathname.startsWith(route)
    )

    if (isAdminRoute && minister.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // If authenticated and trying to access auth pages, redirect to home
  if (user && isPublicRoute) {
    const { data: minister } = await supabase
      .from('ministers')
      .select('is_active')
      .eq('user_id', user.id)
      .single()

    if (minister?.is_active) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
