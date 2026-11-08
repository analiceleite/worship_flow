import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { scheduleMutationError } from '@/lib/schedule/mutation-result'

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  quarter_id: z.string().uuid().optional(),
  role_id: z.string().uuid().optional(),
  event_date: z.string().date().optional(),
  event_type: z.enum(['thursday', 'sunday']).optional(),
  minister_id: z.string().uuid().nullable(),
  is_trainee: z.boolean().optional(),
  conflict_override_reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine(body => body.id || (body.quarter_id && body.role_id && body.event_date && body.event_type))

export async function PATCH(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ requireAdmin: true })
  } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos para atualizar a célula.' }, { status: 400 })
  const { conflict_override_reason, ...payload } = parsed.data
  const admin = createAdminClient()
  // The database derives identity from id, validates every path, locks conflicting
  // mutations, and commits the assignment, exception audit and email outbox together.
  const { data, error } = await admin.rpc('wf32_mutate_schedule', {
    p_church: context.churchId, p_actor: context.ministerId, p_operation: 'assignment',
    p_payload: payload, p_reason: conflict_override_reason ?? null,
  })
  if (error) return scheduleMutationError(error, true)
  const { data: assignment, error: readError } = await admin.from('schedule_assignments')
    .select('id, church_id, quarter_id, role_id, minister_id, is_trainee, event_date, event_type, minister:ministers(id, name, avatar_url)')
    .eq('church_id', context.churchId).eq('id', data.id).single()
  if (readError) return NextResponse.json({ error: 'A célula foi salva; atualize a página para carregá-la.' }, { status: 500 })
  const calendarErrors: Array<{ ministerId: string; error: string }> = []
  for (const id of new Set<string>((data.affected_minister_ids ?? []).filter(Boolean))) {
    try { await reconcileMinisterCalendar(id) } catch (syncError) {
      calendarErrors.push({ ministerId: id, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
    }
  }
  let notification = { processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  try { notification = await processScheduleEmailQueue(200) } catch {
    notificationError = 'Alteração salva. Os avisos estão na fila para nova tentativa automática.'
  }
  return NextResponse.json({ assignment, notification, notification_error: notificationError, calendar_sync: { errors: calendarErrors } })
}
