'use client'

import { Analytics } from '@vercel/analytics/next'
import { usePathname } from 'next/navigation'

export function PrivacyAwareAnalytics() {
  const pathname = usePathname()
  if (!pathname || pathname.startsWith('/auth/')) return null
  return <Analytics beforeSend={(event) => {
    // Also guard SPA navigation while the analytics SDK is already loaded.
    if (new URL(event.url).pathname.startsWith('/auth/')) return null
    return event
  }} />
}
