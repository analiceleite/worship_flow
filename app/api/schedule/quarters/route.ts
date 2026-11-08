import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { quarterRangesOverlap } from '@/lib/schedule/wf32-rules'

type EventType = 'thursday' | 'sunday'

interface ServiceDate {
  event_date: string
  event_type: EventType
}

interface QuarterSeedRow {
  id: string
  end_date: string
}

interface RehearsalSeedRow {
  event_date: string
  event_type: EventType
  rehearsal_date: string | null
  rehearsal_time: string | null
  rehearsal_place: string | null
}

function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function buildPeriodName(startDate: Date, endDate: Date): string {
  const startMonth = startDate.toLocaleDateString('pt-BR', { month: 'long' })
  const endMonth = endDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return `${startMonth.charAt(0).toUpperCase()}${startMonth.slice(1)} a ${endMonth}`
}

function getMonthBoundsFromIsoDate(isoDate: string) {
  const [yearText, monthText] = isoDate.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)

  return {
    start: toDateString(monthStart),
    end: toDateString(monthEnd),
  }
}

function generateServiceDates(startDate: string, endDate: string): ServiceDate[] {
  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  const dates: ServiceDate[] = []
  let thursdayCount = 0

  const current = new Date(start)
  while (current <= end) {
    const dayOfWeek = current.getDay()

    if (dayOfWeek === 4) {
      thursdayCount += 1
      const bandNumber = ((thursdayCount - 1) % 3) + 1
      dates.push({
        event_date: toDateString(current),
        event_type: 'thursday',
      })
    }

    if (dayOfWeek === 0) {
      dates.push({
        event_date: toDateString(current),
        event_type: 'sunday',
      })
    }

    current.setDate(current.getDate() + 1)
  }

  return dates
}

export const dynamic = 'force-dynamic'

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
  let query = adminSupabase
    .from('schedule_quarters')
    .select('id, church_id, name, start_date, end_date, is_published, created_at')
    .eq('church_id', context.churchId)
    .order('start_date', { ascending: false })

  if (context.role !== 'admin') query = query.eq('is_published', true)
  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ quarters: data ?? [] })
}

export async function POST(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ requireAdmin: true })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const body = await request.json()
  const rawName = String(body?.name ?? '').trim()
  const requestedStartDate = String(body?.start_date ?? '').trim()
  const requestedEndDate = String(body?.end_date ?? '').trim()
  const useBimonthlyFlow = body?.use_bimonthly_flow !== false

  const thursdayArrivalTime = String(body?.thursday_arrival_time ?? '19:00').trim()
  const thursdayServiceTime = String(body?.thursday_service_time ?? '20:00').trim()
  const sundayArrivalTime = String(body?.sunday_arrival_time ?? '16:00').trim()
  const sundayServiceTime = String(body?.sunday_service_time ?? '18:30').trim()

  const timeRegex = /^\d{2}:\d{2}$/
  if (!timeRegex.test(thursdayArrivalTime) || !timeRegex.test(thursdayServiceTime) ||
      !timeRegex.test(sundayArrivalTime) || !timeRegex.test(sundayServiceTime)) {
    return NextResponse.json(
      { error: 'Horários devem estar no formato HH:mm' },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()

  let startDate = requestedStartDate
  let endDate = requestedEndDate
  let name = rawName
  let previousQuarterForSeed: QuarterSeedRow | null = null
  let overlapMonthBounds: { start: string; end: string } | null = null

  if (useBimonthlyFlow) {
    const { data: latestQuarter, error: latestQuarterError } = await adminSupabase
      .from('schedule_quarters')
      .select('id, end_date')
      .eq('church_id', context.churchId)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestQuarterError) {
      return NextResponse.json({ error: latestQuarterError.message }, { status: 500 })
    }

    previousQuarterForSeed = (latestQuarter as QuarterSeedRow | null) ?? null

    const baseDate = latestQuarter?.end_date
      ? new Date(`${latestQuarter.end_date}T12:00:00`)
      : new Date()

    const computedStart = getMonthStart(latestQuarter?.end_date ? addMonths(baseDate, 1) : baseDate)
    const computedEnd = getMonthEnd(addMonths(computedStart, 2))
    startDate = toDateString(computedStart)
    endDate = toDateString(computedEnd)

    if (!name) {
      name = buildPeriodName(computedStart, computedEnd)
    }

    if (previousQuarterForSeed) {
      overlapMonthBounds = getMonthBoundsFromIsoDate(previousQuarterForSeed.end_date)
    }
  }

  if (!name || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'Nome, data inicial e data final são obrigatórios' },
      { status: 400 }
    )
  }

  if (startDate > endDate) {
    return NextResponse.json(
      { error: 'A data inicial não pode ser maior que a data final' },
      { status: 400 }
    )
  }

  const { data: existingPeriods, error: periodsError } = await adminSupabase
    .from('schedule_quarters')
    .select('id, start_date, end_date')
    .eq('church_id', context.churchId)

  if (periodsError) {
    return NextResponse.json({ error: periodsError.message }, { status: 500 })
  }

  const overlap = (existingPeriods ?? []).find((period: { start_date: string; end_date: string }) =>
    quarterRangesOverlap({ start_date: startDate, end_date: endDate }, period)
  )
  if (overlap) {
    return NextResponse.json(
      { error: 'O período se sobrepõe a outro período cadastrado nesta igreja.' },
      { status: 409 }
    )
  }

  const { data: duplicatedQuarter, error: duplicatedQuarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id')
    .eq('church_id', context.churchId)
    .eq('start_date', startDate)
    .eq('end_date', endDate)
    .maybeSingle()

  if (duplicatedQuarterError) {
    return NextResponse.json({ error: duplicatedQuarterError.message }, { status: 500 })
  }

  if (duplicatedQuarter) {
    return NextResponse.json(
      { error: 'Já existe um período cadastrado para este intervalo de datas' },
      { status: 409 }
    )
  }

  const generatedDates = generateServiceDates(startDate, endDate)
  if (!generatedDates.length) {
    return NextResponse.json(
      { error: 'O período informado não contém quintas ou domingos' },
      { status: 400 }
    )
  }
  const { data: quarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .insert({
      name,
      church_id: context.churchId,
      start_date: startDate,
      end_date: endDate,
      created_by: context.ministerId,
      thursday_arrival_time: thursdayArrivalTime,
      thursday_service_time: thursdayServiceTime,
      sunday_arrival_time: sundayArrivalTime,
      sunday_service_time: sundayServiceTime,
    })
    .select('id, church_id, name, start_date, end_date, is_published, created_at')
    .single()

  if (quarterError || !quarter) {
    if (quarterError?.message.includes('WF32_QUARTER_OVERLAP')) {
      return NextResponse.json(
        { error: 'O período se sobrepõe a outro período cadastrado nesta igreja.' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: quarterError?.message ?? 'Erro ao criar bimestre' },
      { status: 500 }
    )
  }

  const { data: roles, error: rolesError } = await adminSupabase
    .from('schedule_roles')
    .select('id')

  if (rolesError || !roles?.length) {
    return NextResponse.json(
      { error: rolesError?.message ?? 'Nenhuma função de escala encontrada' },
      { status: 500 }
    )
  }

  const assignmentRows: Array<{
    quarter_id: string
    minister_id: string | null
    is_trainee: boolean
    role_id: string
    event_date: string
    event_type: EventType
    church_id: string
  }> = []

  const seedAssignmentsMap = new Map<string, { minister_id: string | null; is_trainee: boolean }>()

  if (previousQuarterForSeed && overlapMonthBounds) {
    const { data: seedAssignments, error: seedAssignmentsError } = await adminSupabase
      .from('schedule_assignments')
      .select('role_id, event_date, event_type, minister_id, is_trainee')
      .eq('church_id', context.churchId)
      .eq('quarter_id', previousQuarterForSeed.id)
      .gte('event_date', overlapMonthBounds.start)
      .lte('event_date', overlapMonthBounds.end)

    if (seedAssignmentsError) {
      return NextResponse.json({ error: seedAssignmentsError.message }, { status: 500 })
    }

    for (const row of seedAssignments ?? []) {
      const key = `${row.role_id}_${row.event_date}_${row.event_type}`
      seedAssignmentsMap.set(key, {
        minister_id: row.minister_id,
        is_trainee: Boolean(row.is_trainee),
      })
    }
  }

  for (const role of roles) {
    for (const dateInfo of generatedDates) {
      const seedKey = `${role.id}_${dateInfo.event_date}_${dateInfo.event_type}`
      const seededAssignment = seedAssignmentsMap.get(seedKey)

      assignmentRows.push({
        quarter_id: quarter.id,
        church_id: context.churchId,
        minister_id: seededAssignment?.minister_id ?? null,
        is_trainee: seededAssignment?.is_trainee ?? false,
        role_id: role.id,
        event_date: dateInfo.event_date,
        event_type: dateInfo.event_type
      })
    }
  }

  const { error: assignmentsError } = await adminSupabase
    .from('schedule_assignments')
    .insert(assignmentRows)

  if (assignmentsError) {
    return NextResponse.json(
      { error: assignmentsError.message },
      { status: 500 }
    )
  }

  if (previousQuarterForSeed && overlapMonthBounds) {
    const { data: seedRehearsals, error: seedRehearsalsError } = await adminSupabase
      .from('schedule_rehearsals')
      .select('event_date, event_type, rehearsal_date, rehearsal_time, rehearsal_place')
      .eq('church_id', context.churchId)
      .eq('quarter_id', previousQuarterForSeed.id)
      .gte('event_date', overlapMonthBounds.start)
      .lte('event_date', overlapMonthBounds.end)

    if (seedRehearsalsError) {
      return NextResponse.json({ error: seedRehearsalsError.message }, { status: 500 })
    }

    const rehearsalRows = ((seedRehearsals ?? []) as RehearsalSeedRow[]).map((row) => ({
      quarter_id: quarter.id,
      church_id: context.churchId,
      event_date: row.event_date,
      event_type: row.event_type,
      rehearsal_date: row.rehearsal_date,
      rehearsal_time: row.rehearsal_time,
      rehearsal_place: row.rehearsal_place,
    }))

    if (rehearsalRows.length > 0) {
      const { error: rehearsalInsertError } = await adminSupabase
        .from('schedule_rehearsals')
        .insert(rehearsalRows)

      if (rehearsalInsertError) {
        return NextResponse.json({ error: rehearsalInsertError.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ quarter }, { status: 201 })
}
