import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Invitation links carry a bearer token. Keep them out of search engines and
// never leak the token through the Referer header.
export const metadata: Metadata = {
  title: 'Convite — Worship Flow',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function InviteLayout({ children }: { children: ReactNode }) {
  return children
}
