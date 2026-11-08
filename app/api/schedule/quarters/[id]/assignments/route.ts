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
  church_id: string
  minister: { id: string; name: string; avatar_url: string | null } | null
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : 1))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

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

  let quarterQuery = adminSupabase
      .from('schedule_quarters')
      .select('id, church_id, name, start_date, end_date, is_published, created_at')
      .eq('id', id)
      .eq('church_id', context.churchId)
  if (context.role !== 'admin') quarterQuery = quarterQuery.eq('is_published', true)
  const quarterRes = await quarterQuery.maybeSingle()
  if (quarterRes.error) {
    return NextResponse.json({ error: 'Não foi possível consultar o período' }, { status: 500 })
  }
  if (!quarterRes.data) {
    return NextResponse.json({ error: 'Período indisponível' }, { status: 404 })
  }

  const [rolesRes, assignmentsRes, controlsRes, ministersRes] = await Promise.all([
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
      .eq('quarter_id', id),
    adminSupabase
      .from('schedule_event_controls')
      .select('event_date, event_type, leader_minister_id, status, leader:ministers!schedule_event_controls_leader_minister_id_fkey(id, name)')
      .eq('church_id', context.churchId)
      .eq('quarter_id', id),
    adminSupabase
      .from('ministers')
      .select('id, name')
      .eq('church_id', context.churchId)
      .eq('is_active', true)
      .eq('access_state', 'active')
      .order('name', { ascending: true }),
  ])

  if (rolesRes.error) {
    return NextResponse.json({ error: rolesRes.error.message }, { status: 500 })
  }

  if (assignmentsRes.error) {
    return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 })
  }
  if (controlsRes.error || ministersRes.error) {
    return NextResponse.json({ error: controlsRes.error?.message ?? ministersRes.error?.message }, { status: 500 })
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
    quarter: quarterRes.data,
    roles,
    assignments,
    event_controls: controlsRes.data ?? [],
    active_ministers: ministersRes.data ?? [],
    dates: {
      sunday: sundayDates,
      thursday: thursdayDates,
    },
  })
}
