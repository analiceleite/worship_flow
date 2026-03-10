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

  const { data: currentSchedule, error: scheduleError } = await supabase
    .from('worship_schedules')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 500 })
  }

  if (!currentSchedule) {
    return NextResponse.json({ schedule: null }, { status: 200 })
  }

  const adminSupabase = createAdminClient()
  const { data: signedData, error: signedError } = await adminSupabase.storage
    .from('worship-schedules')
    .createSignedUrl(currentSchedule.storage_path, 60 * 60 * 24)

  if (signedError) {
    return NextResponse.json({ error: signedError.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      schedule: {
        ...currentSchedule,
        signedUrl: signedData.signedUrl,
      },
    },
    { status: 200 }
  )
}
