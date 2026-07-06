import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { disconnectMinister } from '@/lib/google-calendar/reconcile'

export async function POST() {
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

  try {
    await disconnectMinister(minister.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
