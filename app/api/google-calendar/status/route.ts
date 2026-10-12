import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function GET() {
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const admin = createAdminClient()
  const [tokenRes, mappingRes] = await Promise.all([
    admin
      .from('google_calendar_tokens')
      .select('connected_at')
      .eq('church_id', context.churchId)
      .eq('minister_id', context.ministerId)
      .maybeSingle(),
    admin
      .from('google_calendar_event_map')
      .select('id', { count: 'exact', head: true })
      .eq('church_id', context.churchId)
      .eq('minister_id', context.ministerId),
  ])

  return NextResponse.json({
    connected: !!tokenRes.data,
    connectedAt: tokenRes.data?.connected_at ?? null,
    syncedEventCount: mappingRes.count ?? 0,
  })
}
