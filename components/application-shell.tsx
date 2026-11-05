'use client'

import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/header'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'

const applicationRoutes = [
  ROUTES.SONGS,
  ROUTES.REPERTOIRE,
  ROUTES.SCHEDULE,
  ROUTES.USERS,
  ROUTES.PROFILE,
  ROUTES.RELEASE_NOTES,
  ROUTES.PLATFORM_CHURCHES,
]

export function ApplicationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const isApplicationRoute = applicationRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`))

  // Authentication and public pages must not inherit the sidebar layout.
  if (!isApplicationRoute) return children

  return (
    <div className={cn('min-h-screen min-w-0 bg-background', collapsed ? 'md:pl-16' : 'md:pl-60')}>
      <Header desktopMenuCollapsed={collapsed} onDesktopMenuToggle={() => setCollapsed(value => !value)} />
      <div className="min-w-0 w-full">{children}</div>
    </div>
  )
}
