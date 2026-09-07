import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

interface AssignmentPayload {
  id?: string
  quarter_id?: string
  role_id?: string
  event_date?: string
  event_type?: 'thursday' | 'sunday'
  minister_id?: string | null
  is_trainee?: boolean
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = (await request.json()) as AssignmentPayload

  if (!payload.id && (!payload.quarter_id || !payload.role_id || !payload.event_date || !payload.event_type)) {
    return NextResponse.json(
      { error: 'Dados insuficientes para atualizar a célula da escala' },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()

  let roleId = payload.role_id ?? null
  if (!roleId && payload.id) {
    const { data: existingAssignment, error: existingAssignmentError } = await adminSupabase
      .from('schedule_assignments')
      .select('role_id')
      .eq('id', payload.id)
      .single()

    if (existingAssignmentError || !existingAssignment?.role_id) {
      return NextResponse.json(
        { error: existingAssignmentError?.message ?? 'Célula da escala não encontrada' },
        { status: 400 }
      )
    }

    roleId = existingAssignment.role_id
  }

  const { data: role, error: roleError } = await adminSupabase
    .from('schedule_roles')
    .select('id, name, category')
    .eq('id', roleId as string)
    .single()

  if (roleError || !role) {
    return NextResponse.json(
      { error: roleError?.message ?? 'Função da escala não encontrada' },
      { status: 400 }
    )
  }

  if (role.category === 'midia' && payload.minister_id) {
    const { data: selectedMinister, error: selectedMinisterError } = await adminSupabase
      .from('ministers')
      .select('id, role')
      .eq('id', payload.minister_id)
      .single()

    if (selectedMinisterError || selectedMinister?.role !== 'midia') {
      return NextResponse.json(
        { error: 'A função Sonoplasta aceita apenas usuários do grupo Mídia' },
        { status: 400 }
      )
    }
  }

  let assignmentId = payload.id
  let previousMinisterId: string | null = null

  if (assignmentId) {
    const { data: existingById, error: existingByIdError } = await adminSupabase
      .from('schedule_assignments')
      .select('minister_id')
      .eq('id', assignmentId)
      .maybeSingle()

    if (existingByIdError) {
      return NextResponse.json({ error: existingByIdError.message }, { status: 500 })
    }

    previousMinisterId = existingById?.minister_id ?? null
  } else {
    const { data: existing, error: existingError } = await adminSupabase
      .from('schedule_assignments')
      .select('id, minister_id')
      .eq('quarter_id', payload.quarter_id as string)
      .eq('role_id', payload.role_id as string)
      .eq('event_date', payload.event_date as string)
      .eq('event_type', payload.event_type as string)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    if (existing?.id) {
      assignmentId = existing.id
      previousMinisterId = existing.minister_id ?? null
    }
  }

  const writePayload = {
    minister_id: payload.minister_id ?? null,
    is_trainee: payload.minister_id ? Boolean(payload.is_trainee) : false,
  }

  let writeError: string | null = null

  if (assignmentId) {
    const { error } = await adminSupabase
      .from('schedule_assignments')
      .update(writePayload)
      .eq('id', assignmentId)

    if (error) writeError = error.message
  } else {
    const { error } = await adminSupabase
      .from('schedule_assignments')
      .insert({
        quarter_id: payload.quarter_id,
        role_id: payload.role_id,
        event_date: payload.event_date,
        event_type: payload.event_type,
        ...writePayload,
      })

    if (error) writeError = error.message
  }

  if (writeError) {
    return NextResponse.json({ error: writeError }, { status: 500 })
  }

  const query = adminSupabase
    .from('schedule_assignments')
    .select('id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type, minister:ministers(id, name)')

  const { data: assignment, error: assignmentError } = assignmentId
    ? await query.eq('id', assignmentId).single()
    : await query
        .eq('quarter_id', payload.quarter_id as string)
        .eq('role_id', payload.role_id as string)
        .eq('event_date', payload.event_date as string)
        .eq('event_type', payload.event_type as string)
        .single()

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: assignmentError?.message ?? 'Falha ao retornar a célula atualizada' },
      { status: 500 }
    )
  }

  const newMinisterId = payload.minister_id ?? null
  const affectedMinisterIds = new Set(
    [newMinisterId, previousMinisterId].filter((v): v is string => v !== null)
  )
  for (const id of affectedMinisterIds) {
    try {
      await reconcileMinisterCalendar(id)
    } catch (syncError) {
      console.error('Erro ao sincronizar Google Calendar após edição de célula:', syncError)
    }
  }

  return NextResponse.json({ assignment })
}
