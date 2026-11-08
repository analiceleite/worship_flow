import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueScheduleEventNotification, processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'

const bodySchema = z.object({
  quarter_id: z.string().uuid(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_type: z.enum(['thursday', 'sunday']),
  leader_minister_id: z.string().uuid().nullable().optional(),
  action: z.enum(['cancel', 'reactivate']).optional(),
}).strict().refine(body => Boolean(body.action) !== (body.leader_minister_id !== undefined), {
  message: 'Informe somente o líder ou a ação do evento.',
})

export async function PATCH(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ requireAdmin: true })
  } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos para atualizar o evento.' }, { status: 400 })
  const input = parsed.data
  const admin = createAdminClient()

  const { data: quarter, error: quarterError } = await admin
    .from('schedule_quarters')
    .select('id, church_id, start_date, end_date, is_published')
    .eq('id', input.quarter_id)
    .eq('church_id', context.churchId)
    .maybeSingle()
  if (quarterError) return NextResponse.json({ error: quarterError.message }, { status: 500 })
  if (!quarter) return NextResponse.json({ error: 'Período não encontrado.' }, { status: 404 })
  if (input.action && !quarter.is_published) {
    return NextResponse.json({ error: 'Somente eventos de um período publicado podem ser cancelados ou reativados.' }, { status: 409 })
  }
  if (input.event_date < quarter.start_date || input.event_date > quarter.end_date) {
    return NextResponse.json({ error: 'O evento deve estar dentro das datas do período.' }, { status: 400 })
  }

  const { data: assignments, error: assignmentsError } = await admin
    .from('schedule_assignments')
    .select('minister_id')
    .eq('church_id', context.churchId)
    .eq('quarter_id', input.quarter_id)
    .eq('event_date', input.event_date)
    .eq('event_type', input.event_type)
  if (assignmentsError) return NextResponse.json({ error: assignmentsError.message }, { status: 500 })
  if (!assignments?.length) return NextResponse.json({ error: 'Evento não encontrado na escala.' }, { status: 404 })

  if (input.leader_minister_id) {
    const { data: leader, error: leaderError } = await admin.from('ministers')
      .select('id, is_active, access_state')
      .eq('id', input.leader_minister_id)
      .eq('church_id', context.churchId)
      .maybeSingle()
    if (leaderError) return NextResponse.json({ error: leaderError.message }, { status: 500 })
  const assigned = (assignments as Array<{ minister_id: string | null }>).some(row => row.minister_id === input.leader_minister_id)
    if (!leader || !leader.is_active || leader.access_state !== 'active' || !assigned) {
      return NextResponse.json({ error: 'O líder deve ser integrante ativo e estar escalado neste evento.' }, { status: 400 })
    }
  }

  const keyFilters = admin.from('schedule_event_controls')
    .select('status, leader_minister_id')
    .eq('church_id', context.churchId)
    .eq('quarter_id', input.quarter_id)
    .eq('event_date', input.event_date)
    .eq('event_type', input.event_type)
  const { data: previous, error: previousError } = await keyFilters.maybeSingle()
  if (previousError) return NextResponse.json({ error: previousError.message }, { status: 500 })

  const nextStatus = input.action === 'cancel' ? 'cancelled' : input.action === 'reactivate' ? 'scheduled' : previous?.status ?? 'scheduled'
  const nextLeaderId = input.leader_minister_id === undefined ? previous?.leader_minister_id ?? null : input.leader_minister_id
  const changed = nextStatus !== (previous?.status ?? 'scheduled') || nextLeaderId !== (previous?.leader_minister_id ?? null)
  if (!changed) return NextResponse.json({ ok: true, unchanged: true, notification: { queued: 0, failed: 0 }, calendar_sync: { errors: [] } })

  const { error: writeError } = await admin.from('schedule_event_controls').upsert({
    church_id: context.churchId,
    quarter_id: input.quarter_id,
    event_date: input.event_date,
    event_type: input.event_type,
    leader_minister_id: nextLeaderId,
    status: nextStatus,
    cancelled_at: nextStatus === 'cancelled' ? new Date().toISOString() : null,
    cancelled_by: nextStatus === 'cancelled' ? context.ministerId : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'church_id,quarter_id,event_date,event_type' })
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 })

  const notificationType = input.action === 'cancel'
    ? 'event_cancelled'
    : input.action === 'reactivate' ? 'event_reactivated' : 'schedule_changed'
  const affectedIds = [...new Set([
    ...(assignments as Array<{ minister_id: string | null }>).map(row => row.minister_id).filter((id): id is string => Boolean(id)),
    previous?.leader_minister_id,
    nextLeaderId,
  ].filter((id): id is string => Boolean(id)))]
  let notification = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  if (quarter.is_published) {
    try {
      const queued = await enqueueScheduleEventNotification({
        churchId: context.churchId,
        quarterId: input.quarter_id,
        eventDate: input.event_date,
        eventType: input.event_type,
        notificationType,
        changeId: randomUUID(),
        includeMinisterIds: affectedIds,
      })
      const processed = await processScheduleEmailQueue(200)
      notification = { queued: queued.queued, processed: processed.processed, sent: processed.sent, failed: processed.failed, skipped: processed.skipped }
    } catch (error) {
      notificationError = error instanceof Error ? error.message : 'Falha ao enfileirar avisos.'
      console.error('Falha ao notificar alteração de evento:', error)
    }
  }

  const calendar = await reconcileMinistersForQuarter(input.quarter_id).catch(error => ({
    ministers: 0,
    errors: [{ ministerId: '', error: error instanceof Error ? error.message : 'Falha ao sincronizar calendário.' }],
  }))
  return NextResponse.json({
    ok: true,
    control: { quarter_id: input.quarter_id, event_date: input.event_date, event_type: input.event_type, leader_minister_id: nextLeaderId, status: nextStatus },
    notification,
    notification_error: notificationError,
    calendar_sync: calendar,
  })
}
