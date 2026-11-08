import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'
import { scheduleMutationError } from '@/lib/schedule/mutation-result'

const bodySchema = z.object({ is_published: z.boolean() }).strict()

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context
  try { context = await getCurrentMinisterContext({ requireAdmin: true }) } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Informe um período e um estado de publicação válidos.' }, { status: 400 })
  }
  const admin = createAdminClient()
  // Publishing and withdrawing other periods + their outbox entries are atomic.
  const { data, error } = await admin.rpc('wf32_mutate_schedule', {
    p_church: context.churchId, p_actor: context.ministerId, p_operation: 'publish',
    p_payload: { quarter_id: id, is_published: parsed.data.is_published },
  })
  if (error) return scheduleMutationError(error)
  let notifications = { processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  // Also on unchanged retries: a previous failed send remains durably pending.
  try { notifications = await processScheduleEmailQueue(200) } catch {
    notificationError = 'Publicação salva. Avisos estão na fila para nova tentativa automática.'
  }
  const calendarErrors: Array<{ quarterId: string; error: string }> = []
  const { data: quarters, error: quartersError } = await admin.from('schedule_quarters').select('id').eq('church_id', context.churchId)
  if (quartersError) calendarErrors.push({ quarterId: id, error: 'Não foi possível consultar calendários afetados.' })
  for (const quarter of quarters ?? []) {
    try {
      const result = await reconcileMinistersForQuarter(quarter.id)
      calendarErrors.push(...result.errors.map(item => ({ quarterId: quarter.id, error: item.error })))
    } catch (syncError) {
      calendarErrors.push({ quarterId: quarter.id, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
    }
  }
  return NextResponse.json({ quarter: data, notifications, notification_error: notificationError, calendar_sync: { errors: calendarErrors } })
}
