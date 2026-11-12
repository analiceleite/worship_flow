import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'
import { scheduleMutationError } from '@/lib/schedule/mutation-result'

const bodySchema = z.object({
  quarter_id: z.string().uuid(), event_date: z.string().date(), event_type: z.enum(['thursday', 'sunday']),
  leader_minister_id: z.string().uuid().nullable().optional(), action: z.enum(['cancel', 'reactivate']).optional(),
  conflict_override_reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine(body => Boolean(body.action) !== (body.leader_minister_id !== undefined))

export async function PATCH(request: Request) {
  let context
  try { context = await getCurrentMinisterContext({ requireAdmin: true }) } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos para atualizar o evento.' }, { status: 400 })
  const { conflict_override_reason, ...payload } = parsed.data
  const { data, error } = await createAdminClient().rpc('wf32_mutate_schedule', {
    p_church: context.churchId, p_actor: context.ministerId, p_operation: 'control',
    p_payload: payload, p_reason: conflict_override_reason ?? null,
  })
  if (error) return scheduleMutationError(error, true)
  let notification = { processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  try { notification = await processScheduleEmailQueue(200) } catch {
    notificationError = 'Evento salvo. Avisos estão na fila para nova tentativa automática.'
  }
  const calendar = await reconcileMinistersForQuarter(payload.quarter_id, context.churchId).catch(syncError => ({
    ministers: 0, errors: [{ ministerId: '', error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' }],
  }))
  return NextResponse.json({ ok: true, control: data, notification, notification_error: notificationError, calendar_sync: calendar })
}
