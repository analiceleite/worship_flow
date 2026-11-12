import { NextResponse } from 'next/server'
import { publicChurchCreationEnabled } from '@/lib/onboarding/flags'

// WF-38: exposes only the on/off state, so the browser never needs a NEXT_PUBLIC_ flag.
export async function GET() {
  return NextResponse.json(
    { enabled: publicChurchCreationEnabled() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
