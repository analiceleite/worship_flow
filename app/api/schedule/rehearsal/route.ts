import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { z } from 'zod'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'
import { scheduleMutationError } from '@/lib/schedule/mutation-result'

export const dynamic = 'force-dynamic'

type EventType = 'thursday' | 'sunday'

const bodySchema = z.object({
  quarter_id: z.string().uuid(), event_date: z.string().date(), event_type: z.enum(['thursday', 'sunday']),
  rehearsal_date: z.string().date().nullable().optional(),
  rehearsal_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(),
  rehearsal_place: z.string().trim().max(500).nullable().optional(),
  conflict_override_reason: z.string().trim().min(1).max(500).optional(),
}).strict()

// GET: /api/schedule/rehearsal?quarter_id=...&event_date=...&event_type=...
export async function GET(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const { searchParams } = new URL(request.url)
  const quarter_id = searchParams.get('quarter_id')
  const event_date = searchParams.get('event_date')
  const event_type = searchParams.get('event_type')

  if (!quarter_id || !event_date || !event_type) {
    if (!quarter_id) {
      return NextResponse.json({ error: 'Parâmetro quarter_id é obrigatório' }, { status: 400 })
    }
  }

  const supabase = createAdminClient()
  if (context.role !== 'admin') {
    const { data: quarter, error } = await supabase
      .from('schedule_quarters')
      .select('id')
      .eq('id', quarter_id)
      .eq('church_id', context.churchId)
      .eq('is_published', true)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: 'Não foi possível consultar o período' }, { status: 500 })
    }
    if (!quarter) {
      return NextResponse.json({ error: 'Período indisponível' }, { status: 404 })
    }
  }
  const baseQuery = supabase
    .from('schedule_rehearsals')
    .select('*')
    .eq('church_id', context.churchId)
    .eq('quarter_id', quarter_id)

  if (event_date && event_type) {
    const { data, error } = await baseQuery
      .eq('event_date', event_date)
      .eq('event_type', event_type)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rehearsal: data ?? null })
  }

  const { data, error } = await baseQuery.order('event_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rehearsals: data ?? [] })
}

// PATCH: atualiza ou cria dados do ensaio
export async function PATCH(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Informe evento e dados de ensaio válidos.' }, { status: 400 })
  const { conflict_override_reason, ...payload } = parsed.data
  const { data, error } = await createAdminClient().rpc('wf32_mutate_schedule', {
    p_church: context.churchId, p_actor: context.ministerId, p_operation: 'rehearsal',
    p_payload: payload, p_reason: conflict_override_reason ?? null,
  })
  if (error) return scheduleMutationError(error, context.role === 'admin')

  let notification = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  try {
    notification = { queued: 0, ...await processScheduleEmailQueue(200) }
  } catch {
    notificationError = 'Ensaio salvo. Avisos estão na fila para nova tentativa automática.'
  }
  const calendar = await reconcileMinistersForQuarter(payload.quarter_id).catch(syncError => ({
    ministers: 0,
    errors: [{ ministerId: '', error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' }],
  }))

  return NextResponse.json({ rehearsal: data, notification, notification_error: notificationError, calendar_sync: calendar })
}
