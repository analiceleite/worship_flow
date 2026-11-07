import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export const dynamic = 'force-dynamic'

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
  minister: { id: string; name: string; avatar_url: string | null } | null
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : 1))
}

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

  const adminSupabase = createAdminClient()

  const { data: viewer } = await adminSupabase
    .from('ministers')
    .select('id, church_id, name, role')
    .eq('id', context.ministerId)
    .eq('church_id', context.churchId)
    .maybeSingle()

  const { data: publishedQuarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id, church_id, name, start_date, end_date, is_published, created_at, thursday_arrival_time, thursday_service_time, sunday_arrival_time, sunday_service_time')
    .eq('church_id', context.churchId)
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
        'id, church_id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type, minister:ministers(id, name, avatar_url)'
      )
      .eq('church_id', context.churchId)
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
