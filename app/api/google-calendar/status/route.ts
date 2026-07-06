import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: minister } = await admin.from('ministers').select('id').eq('user_id', user.id).single()

  if (!minister) {
    return NextResponse.json({ error: 'Minister not found' }, { status: 404 })
  }

  const [tokenRes, mappingRes] = await Promise.all([
    admin
      .from('google_calendar_tokens')
      .select('connected_at')
      .eq('minister_id', minister.id)
      .maybeSingle(),
    admin
      .from('google_calendar_event_map')
      .select('id', { count: 'exact', head: true })
      .eq('minister_id', minister.id),
  ])

  return NextResponse.json({
    connected: !!tokenRes.data,
    connectedAt: tokenRes.data?.connected_at ?? null,
    syncedEventCount: mappingRes.count ?? 0,
  })
}
