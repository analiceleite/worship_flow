import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface QuarterRole {
  id: string
  name: string
  category: 'ministro' | 'vocal' | 'instrumento' | 'midia'
  display_order: number
}

interface AssignmentRow {
  id: string
  quarter_id: string
  role_id: string
  minister_id: string | null
  is_trainee: boolean
  event_date: string
  event_type: 'thursday' | 'sunday'
  minister: { id: string; name: string } | null
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : 1))
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSupabase = createAdminClient()

  const { data: viewer } = await adminSupabase
    .from('ministers')
    .select('id, name, role')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: publishedQuarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id, name, start_date, end_date, is_published, created_at')
    .eq('is_published', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (quarterError) {
    return NextResponse.json({ error: quarterError.message }, { status: 500 })
  }

  if (!publishedQuarter) {
    return NextResponse.json({ schedule: null, viewer: viewer ?? null }, { status: 200 })
  }

  const [rolesRes, assignmentsRes] = await Promise.all([
    adminSupabase
      .from('schedule_roles')
      .select('id, name, category, display_order')
      .order('display_order', { ascending: true }),
    adminSupabase
      .from('schedule_assignments')
      .select(
        'id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type, minister:ministers(id, name)'
      )
      .eq('quarter_id', publishedQuarter.id),
  ])

  if (rolesRes.error) {
    return NextResponse.json({ error: rolesRes.error.message }, { status: 500 })
  }

  if (assignmentsRes.error) {
    return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 })
  }

  const roles = (rolesRes.data ?? []) as QuarterRole[]
  const roleOrderMap = new Map<string, number>()
  for (const role of roles) {
    roleOrderMap.set(role.id, role.display_order)
  }

  const assignments = ((assignmentsRes.data ?? []) as AssignmentRow[]).sort((a, b) => {
    if (a.event_date !== b.event_date) {
      return a.event_date < b.event_date ? -1 : 1
    }

    const roleA = roleOrderMap.get(a.role_id) ?? 999
    const roleB = roleOrderMap.get(b.role_id) ?? 999
    return roleA - roleB
  })

  const sundayDates = uniqueSorted(
    assignments.filter((item) => item.event_type === 'sunday').map((item) => item.event_date)
  )

  const thursdayDates = uniqueSorted(
    assignments.filter((item) => item.event_type === 'thursday').map((item) => item.event_date)
  )

  return NextResponse.json({
    schedule: {
      quarter: publishedQuarter,
      roles,
      assignments,
      dates: {
        sunday: sundayDates,
        thursday: thursdayDates,
      },
    },
    viewer: viewer ?? null,
  })
}
