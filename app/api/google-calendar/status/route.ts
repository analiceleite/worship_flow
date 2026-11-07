import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function GET(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ churchId: request.headers.get('x-wf-church-id') })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    }
    throw error
  }

  const admin = createAdminClient()
  const [credentialRes, selectionRes, mappingRes, churchCountRes] = await Promise.all([
    admin
      .from('google_calendar_credentials')
      .select('connected_at')
      .eq('user_id', context.userId)
      .maybeSingle(),
    admin
      .from('google_calendar_church_sync')
      .select('enabled_at')
      .eq('user_id', context.userId)
      .eq('church_id', context.churchId)
      .maybeSingle(),
    admin
      .from('google_calendar_event_map')
      .select('id', { count: 'exact', head: true })
      .eq('church_id', context.churchId)
      .eq('minister_id', context.ministerId),
    admin
      .from('google_calendar_church_sync')
      .select('church_id', { count: 'exact', head: true })
      .eq('user_id', context.userId),
  ])

  return NextResponse.json({
    connected: !!credentialRes.data,
    connectedAt: credentialRes.data?.connected_at ?? null,
    syncEnabled: !!selectionRes.data,
    syncedEventCount: mappingRes.count ?? 0,
    connectedChurchCount: churchCountRes.count ?? 0,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
