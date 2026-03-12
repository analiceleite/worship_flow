import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type EventType = 'thursday' | 'sunday'

interface ServiceDate {
  event_date: string
  event_type: EventType
}

function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase
    .from('schedule_quarters')
    .select('id, name, start_date, end_date, is_published, created_at')
    .order('start_date', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ quarters: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const name = String(body?.name ?? '').trim()
  const startDate = String(body?.start_date ?? '').trim()
  const endDate = String(body?.end_date ?? '').trim()

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

  const { data: minister, error: ministerError } = await supabase
    .from('ministers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (ministerError || !minister) {
    return NextResponse.json({ error: 'Ministro não encontrado' }, { status: 404 })
  }

  const generatedDates = generateServiceDates(startDate, endDate)
  if (!generatedDates.length) {
    return NextResponse.json(
      { error: 'O período informado não contém quintas ou domingos' },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()

  const { data: quarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .insert({
      name,
      start_date: startDate,
      end_date: endDate,
      created_by: minister.id,
    })
    .select('id, name, start_date, end_date, is_published, created_at')
    .single()

  if (quarterError || !quarter) {
    return NextResponse.json(
      { error: quarterError?.message ?? 'Erro ao criar trimestre' },
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
    role_id: string
    event_date: string
    event_type: EventType
  }> = []

  for (const role of roles) {
    for (const dateInfo of generatedDates) {
      assignmentRows.push({
        quarter_id: quarter.id,
        minister_id: null,
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

  return NextResponse.json({ quarter }, { status: 201 })
}
