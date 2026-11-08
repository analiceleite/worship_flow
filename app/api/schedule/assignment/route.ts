import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'
import { getScheduleEventInterval } from '@/lib/schedule/event-conflicts'
import { intervalsOverlap } from '@/lib/schedule/wf32-rules'
import { enqueueScheduleEventNotification, processScheduleEmailQueue } from '@/lib/notifications/schedule-email'

interface AssignmentPayload {
  id?: string
  quarter_id?: string
  role_id?: string
  event_date?: string
  event_type?: 'thursday' | 'sunday'
  minister_id?: string | null
  is_trainee?: boolean
  conflict_override_reason?: string
}
type ExistingAssignmentData = { quarter_id: string; event_date: string; event_type: 'thursday' | 'sunday'; minister_id: string | null; is_trainee: boolean }

export async function PATCH(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ requireAdmin: true })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
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
  let existingAssignmentData: ExistingAssignmentData | null = null
  if (!roleId && payload.id) {
    const { data: existingAssignment, error: existingAssignmentError } = await adminSupabase
      .from('schedule_assignments')
      .select('role_id, quarter_id, event_date, event_type, minister_id, is_trainee')
      .eq('id', payload.id)
      .eq('church_id', context.churchId)
      .single()

    if (existingAssignmentError || !existingAssignment?.role_id) {
      return NextResponse.json(
        { error: existingAssignmentError?.message ?? 'Célula da escala não encontrada' },
        { status: 400 }
      )
    }

    roleId = existingAssignment.role_id
    existingAssignmentData = existingAssignment as ExistingAssignmentData
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
      .eq('church_id', context.churchId)
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
      .select('quarter_id, event_date, event_type, minister_id, is_trainee')
      .eq('id', assignmentId)
      .eq('church_id', context.churchId)
      .maybeSingle()

    if (existingByIdError) {
      return NextResponse.json({ error: existingByIdError.message }, { status: 500 })
    }

    if (!existingById) return NextResponse.json({ error: 'Célula da escala não encontrada' }, { status: 404 })
    existingAssignmentData = existingById as ExistingAssignmentData
    previousMinisterId = existingById.minister_id ?? null
  } else {
    const { data: quarter, error: quarterError } = await adminSupabase
      .from('schedule_quarters')
      .select('id')
      .eq('id', payload.quarter_id as string)
      .eq('church_id', context.churchId)
      .maybeSingle()

    if (quarterError) {
      return NextResponse.json({ error: quarterError.message }, { status: 500 })
    }

    if (!quarter) {
      return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
    }

    const { data: existing, error: existingError } = await adminSupabase
      .from('schedule_assignments')
      .select('id, quarter_id, event_date, event_type, minister_id, is_trainee')
      .eq('church_id', context.churchId)
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
      existingAssignmentData = existing as ExistingAssignmentData
    }
  }

  const effectiveQuarterId = payload.quarter_id ?? existingAssignmentData?.quarter_id
  const effectiveEventDate = payload.event_date ?? existingAssignmentData?.event_date
  const effectiveEventType = payload.event_type ?? existingAssignmentData?.event_type
  if (!effectiveQuarterId || !effectiveEventDate || !effectiveEventType) {
    return NextResponse.json({ error: 'Período e data do evento são obrigatórios.' }, { status: 400 })
  }

  const { data: targetQuarter, error: targetQuarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id, start_date, end_date, is_published, thursday_arrival_time, thursday_service_time, sunday_arrival_time, sunday_service_time')
    .eq('id', effectiveQuarterId)
    .eq('church_id', context.churchId)
    .maybeSingle()
  if (targetQuarterError) return NextResponse.json({ error: targetQuarterError.message }, { status: 500 })
  if (!targetQuarter) return NextResponse.json({ error: 'Período não encontrado.' }, { status: 404 })
  if (effectiveEventDate < targetQuarter.start_date || effectiveEventDate > targetQuarter.end_date) {
    return NextResponse.json({ error: 'A data do evento precisa estar dentro do período.' }, { status: 400 })
  }

  const writePayload = {
    minister_id: payload.minister_id ?? null,
    is_trainee: payload.minister_id ? Boolean(payload.is_trainee) : false,
  }
  const scheduleChanged = !existingAssignmentData
    ? Boolean(payload.minister_id)
    : existingAssignmentData.minister_id !== writePayload.minister_id
      || Boolean(existingAssignmentData.is_trainee) !== writePayload.is_trainee
  let overrideAuditRows: Array<Record<string, unknown>> = []

  if (payload.minister_id) {
    const { data: selectedMinister, error: selectedMinisterError } = await adminSupabase
      .from('ministers')
      .select('id, is_active, access_state')
      .eq('id', payload.minister_id)
      .eq('church_id', context.churchId)
      .maybeSingle()

    if (selectedMinisterError) {
      return NextResponse.json({ error: selectedMinisterError.message }, { status: 500 })
    }

    if (!selectedMinister || !selectedMinister.is_active || selectedMinister.access_state !== 'active') {
      return NextResponse.json({ error: 'Ministro não encontrado nesta igreja' }, { status: 400 })
    }

    if (payload.minister_id !== previousMinisterId) {
      const [allAssignmentsRes, quartersRes, rehearsalsRes, controlsRes, churchRes] = await Promise.all([
        adminSupabase.from('schedule_assignments')
          .select('quarter_id, event_date, event_type, minister_id')
          .eq('church_id', context.churchId)
          .eq('minister_id', payload.minister_id),
        adminSupabase.from('schedule_quarters')
          .select('id, start_date, end_date, thursday_arrival_time, thursday_service_time, sunday_arrival_time, sunday_service_time')
          .eq('church_id', context.churchId),
        adminSupabase.from('schedule_rehearsals')
          .select('quarter_id, event_date, event_type, rehearsal_date, rehearsal_time')
          .eq('church_id', context.churchId),
        adminSupabase.from('schedule_event_controls')
          .select('quarter_id, event_date, event_type, status')
          .eq('church_id', context.churchId)
          .eq('status', 'cancelled'),
        adminSupabase.from('churches').select('timezone').eq('id', context.churchId).maybeSingle(),
      ])
      const queryError = allAssignmentsRes.error ?? quartersRes.error ?? rehearsalsRes.error ?? controlsRes.error ?? churchRes.error
      if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 })

      const quarters = new Map<string, { id: string; start_date: string; end_date: string; thursday_arrival_time: string; thursday_service_time: string; sunday_arrival_time: string; sunday_service_time: string }>(
        (quartersRes.data ?? []).map((quarter: { id: string; start_date: string; end_date: string; thursday_arrival_time: string; thursday_service_time: string; sunday_arrival_time: string; sunday_service_time: string }) => [quarter.id, quarter])
      )
      const rehearsalByEvent = new Map((rehearsalsRes.data ?? []).map((item: { quarter_id: string; event_date: string; event_type: string }) => [
        `${item.quarter_id}_${item.event_date}_${item.event_type}`, item,
      ]))
      const cancelled = new Set((controlsRes.data ?? []).map((item: { quarter_id: string; event_date: string; event_type: string }) =>
        `${item.quarter_id}_${item.event_date}_${item.event_type}`
      ))
      const timezone = churchRes.data?.timezone ?? 'America/Sao_Paulo'
      const candidateEvent = { quarter_id: effectiveQuarterId, event_date: effectiveEventDate, event_type: effectiveEventType }
      const candidateInterval = getScheduleEventInterval({ event: candidateEvent, quarter: targetQuarter, timeZone: timezone })
      const conflicts = new Map<string, { event_date: string; event_type: string }>()
      for (const row of (allAssignmentsRes.data ?? []) as Array<{ quarter_id: string; event_date: string; event_type: 'thursday' | 'sunday' }>) {
        const key = `${row.quarter_id}_${row.event_date}_${row.event_type}`
        if (key === `${effectiveQuarterId}_${effectiveEventDate}_${effectiveEventType}` || cancelled.has(key)) continue
        const quarter = quarters.get(row.quarter_id)
        if (!quarter) continue
        const rehearsal = rehearsalByEvent.get(key) as { rehearsal_date?: string | null; rehearsal_time?: string | null } | undefined
        const interval = getScheduleEventInterval({ event: { ...row, ...rehearsal }, quarter, timeZone: timezone })
        if (intervalsOverlap(candidateInterval, interval)) conflicts.set(key, { event_date: row.event_date, event_type: row.event_type })
      }

      if (conflicts.size && !payload.conflict_override_reason?.trim()) {
        const firstConflict = [...conflicts.values()][0]
        return NextResponse.json({
          error: 'Este integrante já está escalado em um evento com horário conflitante.',
          conflict: firstConflict,
          override_allowed: true,
        }, { status: 409 })
      }
      if (conflicts.size && payload.conflict_override_reason?.trim()) {
        const reason = payload.conflict_override_reason.trim().slice(0, 500)
        overrideAuditRows = [...conflicts.values()].map(conflict => ({
            church_id: context.churchId,
            quarter_id: effectiveQuarterId,
            assignment_id: assignmentId ?? null,
            minister_id: payload.minister_id,
            event_date: effectiveEventDate,
            event_type: effectiveEventType,
            conflict_event_date: conflict.event_date,
            conflict_event_type: conflict.event_type,
            reason,
            overridden_by: context.ministerId,
          }))
      }
    }
  }

  let writeError: string | null = null

  if (assignmentId) {
    const { error } = await adminSupabase
      .from('schedule_assignments')
      .update(writePayload)
      .eq('id', assignmentId)
      .eq('church_id', context.churchId)

    if (error) writeError = error.message
  } else {
    const { error } = await adminSupabase
      .from('schedule_assignments')
      .insert({
        church_id: context.churchId,
        quarter_id: effectiveQuarterId,
        role_id: payload.role_id,
        event_date: effectiveEventDate,
        event_type: effectiveEventType,
        ...writePayload,
      })

    if (error) writeError = error.message
  }

  if (writeError) {
    return NextResponse.json({ error: writeError }, { status: 500 })
  }

  if (overrideAuditRows.length) {
    const { error: auditError } = await adminSupabase.from('schedule_conflict_overrides').insert(overrideAuditRows)
    if (auditError) return NextResponse.json({ error: `A escala foi salva, mas não foi possível registrar a justificativa: ${auditError.message}` }, { status: 500 })
  }

  const query = adminSupabase
    .from('schedule_assignments')
    .select('id, church_id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type, minister:ministers(id, name, avatar_url)')
    .eq('church_id', context.churchId)

  const { data: assignment, error: assignmentError } = assignmentId
    ? await query.eq('id', assignmentId).single()
    : await query
        .eq('quarter_id', effectiveQuarterId)
        .eq('role_id', payload.role_id as string)
        .eq('event_date', effectiveEventDate)
        .eq('event_type', effectiveEventType)
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
  const calendarErrors: Array<{ ministerId: string; error: string }> = []
  for (const id of affectedMinisterIds) {
    try {
      await reconcileMinisterCalendar(id)
    } catch (syncError) {
      console.error('Erro ao sincronizar Google Calendar após edição de célula:', syncError)
      calendarErrors.push({ ministerId: id, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
    }
  }

  let notification = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  if (scheduleChanged && targetQuarter.is_published) {
    try {
      const queued = await enqueueScheduleEventNotification({
        churchId: context.churchId, quarterId: effectiveQuarterId, eventDate: effectiveEventDate,
        eventType: effectiveEventType, notificationType: 'schedule_changed', changeId: randomUUID(),
        includeMinisterIds: [...affectedMinisterIds],
      })
      const processed = await processScheduleEmailQueue(200)
      notification = { queued: queued.queued, processed: processed.processed, sent: processed.sent, failed: processed.failed, skipped: processed.skipped }
    } catch (notifyError) {
      notificationError = notifyError instanceof Error ? notifyError.message : 'Falha ao enfileirar avisos.'
      console.error('Falha ao notificar alteração na escala:', notifyError)
    }
  }

  return NextResponse.json({ assignment, notification, notification_error: notificationError, calendar_sync: { errors: calendarErrors } })
}
