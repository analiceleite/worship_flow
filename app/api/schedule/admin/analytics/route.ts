import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type EventType = 'thursday' | 'sunday'

interface QuarterRow {
  id: string
  name: string
  start_date: string
  end_date: string
  is_published: boolean
  created_at: string
}

interface RoleRow {
  id: string
  name: string
  category: 'ministro' | 'vocal' | 'instrumento' | 'midia'
  display_order: number
}

interface MinisterRow {
  id: string
  name: string
  role: 'admin' | 'minister' | 'midia'
  instrument: string
  is_active: boolean
}

interface AssignmentRow {
  id: string
  quarter_id: string
  role_id: string
  minister_id: string | null
  is_trainee: boolean
  event_date: string
  event_type: EventType
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function getQuarterLabel(quarter: QuarterRow) {
  return `${quarter.name} (${quarter.start_date} a ${quarter.end_date})`
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSupabase = createAdminClient()

  const { data: viewer, error: viewerError } = await adminSupabase
    .from('ministers')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (viewerError || !viewer) {
    return NextResponse.json({ error: 'Usuário sem perfil de ministro' }, { status: 403 })
  }

  if (viewer.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso restrito para administradores' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const requestedQuarterId = searchParams.get('quarter_id')

  let quarter: QuarterRow | null = null

  if (requestedQuarterId) {
    const { data, error } = await adminSupabase
      .from('schedule_quarters')
      .select('id, name, start_date, end_date, is_published, created_at')
      .eq('id', requestedQuarterId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    quarter = (data as QuarterRow | null) ?? null
  } else {
    const { data, error } = await adminSupabase
      .from('schedule_quarters')
      .select('id, name, start_date, end_date, is_published, created_at')
      .eq('is_published', true)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    quarter = (data as QuarterRow | null) ?? null
  }

  if (!quarter) {
    return NextResponse.json(
      {
        quarter: null,
        summary: {
          total_slots: 0,
          filled_slots: 0,
          empty_slots: 0,
          coverage_percent: 0,
          trainees: 0,
          active_ministers: 0,
          average_assignments_per_minister: 0,
          overloaded_ministers: 0,
          underutilized_ministers: 0,
        },
        by_role: [],
        by_minister: [],
        by_event: [],
        alerts: {
          overloaded_ministers: [],
          events_with_gaps: [],
        },
      },
      { status: 200 }
    )
  }

  const [rolesRes, ministersRes, assignmentsRes] = await Promise.all([
    adminSupabase
      .from('schedule_roles')
      .select('id, name, category, display_order')
      .order('display_order', { ascending: true }),
    adminSupabase
      .from('ministers')
      .select('id, name, role, instrument, is_active')
      .eq('is_active', true)
      .in('role', ['admin', 'minister'])
      .order('name', { ascending: true }),
    adminSupabase
      .from('schedule_assignments')
      .select('id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type')
      .eq('quarter_id', quarter.id),
  ])

  if (rolesRes.error) {
    return NextResponse.json({ error: rolesRes.error.message }, { status: 500 })
  }

  if (ministersRes.error) {
    return NextResponse.json({ error: ministersRes.error.message }, { status: 500 })
  }

  if (assignmentsRes.error) {
    return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 })
  }

  const roles = (rolesRes.data ?? []) as RoleRow[]
  const ministers = (ministersRes.data ?? []) as MinisterRow[]
  const assignments = (assignmentsRes.data ?? []) as AssignmentRow[]

  const roleById = new Map(roles.map((role) => [role.id, role]))
  const assignmentsByRole = new Map<string, AssignmentRow[]>()
  const assignmentsByMinister = new Map<string, AssignmentRow[]>()
  const assignmentsByEvent = new Map<string, AssignmentRow[]>()

  for (const assignment of assignments) {
    const roleBucket = assignmentsByRole.get(assignment.role_id) ?? []
    roleBucket.push(assignment)
    assignmentsByRole.set(assignment.role_id, roleBucket)

    if (assignment.minister_id) {
      const ministerBucket = assignmentsByMinister.get(assignment.minister_id) ?? []
      ministerBucket.push(assignment)
      assignmentsByMinister.set(assignment.minister_id, ministerBucket)
    }

    const eventKey = `${assignment.event_date}_${assignment.event_type}`
    const eventBucket = assignmentsByEvent.get(eventKey) ?? []
    eventBucket.push(assignment)
    assignmentsByEvent.set(eventKey, eventBucket)
  }

  const totalSlots = assignments.length
  const filledSlots = assignments.filter((item) => Boolean(item.minister_id)).length
  const emptySlots = totalSlots - filledSlots
  const trainees = assignments.filter((item) => Boolean(item.minister_id) && item.is_trainee).length
  const activeMinisters = ministers.length
  const averageAssignmentsPerMinister = activeMinisters > 0 ? filledSlots / activeMinisters : 0

  const byRole = roles.map((role) => {
    const roleAssignments = assignmentsByRole.get(role.id) ?? []
    const filled = roleAssignments.filter((item) => Boolean(item.minister_id)).length
    const total = roleAssignments.length

    return {
      role_id: role.id,
      role_name: role.name,
      category: role.category,
      total,
      filled,
      empty: total - filled,
      trainees: roleAssignments.filter((item) => Boolean(item.minister_id) && item.is_trainee).length,
      coverage_percent: total > 0 ? round((filled / total) * 100) : 0,
    }
  })

  const byMinister = ministers
    .map((minister) => {
      const ministerAssignments = assignmentsByMinister.get(minister.id) ?? []
      const totalAssignments = ministerAssignments.length
      const overloadDeltaPercent =
        averageAssignmentsPerMinister > 0
          ? round(((totalAssignments - averageAssignmentsPerMinister) / averageAssignmentsPerMinister) * 100)
          : 0

      return {
        minister_id: minister.id,
        name: minister.name,
        instrument: minister.instrument,
        role: minister.role,
        total_assignments: totalAssignments,
        sunday_assignments: ministerAssignments.filter((item) => item.event_type === 'sunday').length,
        thursday_assignments: ministerAssignments.filter((item) => item.event_type === 'thursday').length,
        trainee_assignments: ministerAssignments.filter((item) => item.is_trainee).length,
        overload_delta_percent: overloadDeltaPercent,
        is_overloaded: totalAssignments > averageAssignmentsPerMinister * 1.3,
        is_underutilized: totalAssignments < averageAssignmentsPerMinister * 0.7,
      }
    })
    .sort((a, b) => b.total_assignments - a.total_assignments || a.name.localeCompare(b.name))

  const roleOrder = new Map(roles.map((role) => [role.id, role.display_order]))

  const byEvent = Array.from(assignmentsByEvent.entries())
    .map(([eventKey, eventAssignments]) => {
      const [eventDate, eventType] = eventKey.split('_') as [string, EventType]
      const filled = eventAssignments.filter((item) => Boolean(item.minister_id)).length
      const total = eventAssignments.length

      const missingRoles = eventAssignments
        .filter((item) => !item.minister_id)
        .sort((a, b) => (roleOrder.get(a.role_id) ?? 999) - (roleOrder.get(b.role_id) ?? 999))
        .map((item) => roleById.get(item.role_id)?.name ?? 'Função não identificada')

      return {
        event_date: eventDate,
        event_type: eventType,
        total_slots: total,
        filled_slots: filled,
        empty_slots: total - filled,
        coverage_percent: total > 0 ? round((filled / total) * 100) : 0,
        missing_roles: missingRoles,
      }
    })
    .sort((a, b) => {
      if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1
      return a.event_type.localeCompare(b.event_type)
    })

  const overloadedMinisters = byMinister
    .filter((item) => item.is_overloaded)
    .map((item) => ({
      minister_id: item.minister_id,
      name: item.name,
      total_assignments: item.total_assignments,
      overload_delta_percent: item.overload_delta_percent,
    }))

  const eventsWithGaps = byEvent
    .filter((event) => event.empty_slots > 0)
    .sort((a, b) => b.empty_slots - a.empty_slots || (a.event_date < b.event_date ? -1 : 1))

  const underutilizedMinisters = byMinister.filter((item) => item.is_underutilized).length

  return NextResponse.json({
    quarter,
    quarter_label: getQuarterLabel(quarter),
    summary: {
      total_slots: totalSlots,
      filled_slots: filledSlots,
      empty_slots: emptySlots,
      coverage_percent: totalSlots > 0 ? round((filledSlots / totalSlots) * 100) : 0,
      trainees,
      active_ministers: activeMinisters,
      average_assignments_per_minister: round(averageAssignmentsPerMinister, 2),
      overloaded_ministers: overloadedMinisters.length,
      underutilized_ministers: underutilizedMinisters,
    },
    by_role: byRole,
    by_minister: byMinister,
    by_event: byEvent,
    alerts: {
      overloaded_ministers: overloadedMinisters,
      events_with_gaps: eventsWithGaps,
    },
    generated_at: new Date().toISOString(),
  })
}
