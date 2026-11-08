import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { scheduleMutationError } from '@/lib/schedule/mutation-result'

const bodySchema = z.object({
  items: z.array(z.object({
    assignment_id: z.string().uuid(), minister_id: z.string().uuid().nullable(), is_trainee: z.boolean().optional(),
  }).strict()).min(1).max(1000),
  conflict_override_reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine(body => new Set(body.items.map(item => item.assignment_id)).size === body.items.length)

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context
  try { context = await getCurrentMinisterContext({ requireAdmin: true }) } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Informe um período e células válidos, sem duplicatas.' }, { status: 400 })
  }
  const admin = createAdminClient()
  // One transaction for the entire import: no partially applied batch on error.
  const { data, error } = await admin.rpc('wf32_mutate_schedule', {
    p_church: context.churchId, p_actor: context.ministerId, p_operation: 'import',
    p_payload: { quarter_id: id, items: parsed.data.items }, p_reason: parsed.data.conflict_override_reason ?? null,
  })
  if (error) return scheduleMutationError(error, true)
  const errors: Array<{ ministerId: string; error: string }> = []
  for (const ministerId of new Set<string>((data.affected_minister_ids ?? []).filter(Boolean))) {
    try { await reconcileMinisterCalendar(ministerId) } catch (syncError) {
      errors.push({ ministerId, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
    }
  }
  let notificationError: string | null = null
  try { await processScheduleEmailQueue(200) } catch { notificationError = 'Avisos salvos na fila; haverá nova tentativa automática.' }
  return NextResponse.json({ ok: true, updated_count: data.updated_count, skipped_count: data.skipped_count,
    notification_error: notificationError, calendar_sync: { errors } })
}
