import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { randomUUID } from 'node:crypto'
import { enqueueScheduleEventNotification, processScheduleEmailQueue } from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'

export const dynamic = 'force-dynamic'

type EventType = 'thursday' | 'sunday'

interface RehearsalPayload {
  quarter_id?: string
  event_date?: string
  event_type?: EventType
  rehearsal_date?: string | null
  rehearsal_time?: string | null
  rehearsal_place?: string | null
}

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

  if (context.role !== 'admin' && context.role !== 'minister') {
    return NextResponse.json({ error: 'Permissão insuficiente para editar ensaio' }, { status: 403 })
  }

  const payload = (await request.json()) as RehearsalPayload
  const { quarter_id, event_date, event_type, rehearsal_date, rehearsal_time, rehearsal_place } = payload

  if (!quarter_id || !event_date || !event_type) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios ausentes' }, { status: 400 })
  }

  const adminSupabase = createAdminClient()

  const { data: quarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id, is_published, start_date, end_date')
    .eq('id', quarter_id)
    .eq('church_id', context.churchId)
    .maybeSingle()

  if (quarterError) {
    return NextResponse.json({ error: quarterError.message }, { status: 500 })
  }

  if (!quarter) {
    return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
  }

  if (context.role !== 'admin') {
    if (!quarter.is_published) return NextResponse.json({ error: 'Rascunhos são privados.' }, { status: 404 })
    const { data: control, error: controlError } = await adminSupabase.from('schedule_event_controls')
      .select('leader_minister_id, status')
      .eq('church_id', context.churchId).eq('quarter_id', quarter_id)
      .eq('event_date', event_date).eq('event_type', event_type).maybeSingle()
    if (controlError) return NextResponse.json({ error: controlError.message }, { status: 500 })
    if (control?.leader_minister_id !== context.ministerId || control.status === 'cancelled') {
      return NextResponse.json({ error: 'Somente o líder designado do evento pode editar o ensaio.' }, { status: 403 })
    }
  }

  if (event_date < quarter.start_date || event_date > quarter.end_date) {
    return NextResponse.json({ error: 'A data do evento precisa estar dentro do período.' }, { status: 400 })
  }
  if (rehearsal_time && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(rehearsal_time)) {
    return NextResponse.json({ error: 'Informe um horário de ensaio válido.' }, { status: 400 })
  }

  const { data: existingRehearsal, error: existingError } = await adminSupabase
    .from('schedule_rehearsals').select('rehearsal_date, rehearsal_time, rehearsal_place')
    .eq('church_id', context.churchId).eq('quarter_id', quarter_id)
    .eq('event_date', event_date).eq('event_type', event_type).maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  const hasChanged = existingRehearsal?.rehearsal_date !== (rehearsal_date ?? null)
    || existingRehearsal?.rehearsal_time !== (rehearsal_time ?? null)
    || existingRehearsal?.rehearsal_place !== (rehearsal_place ?? null)

  // UPSERT
  const { data, error } = await adminSupabase
    .from('schedule_rehearsals')
    .upsert([
      {
        church_id: context.churchId,
        quarter_id,
        event_date,
        event_type,
        rehearsal_date,
        rehearsal_time,
        rehearsal_place,
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: 'quarter_id,event_date,event_type' })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let notification = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  if (hasChanged && quarter.is_published) {
    try {
      const queued = await enqueueScheduleEventNotification({
        churchId: context.churchId, quarterId: quarter_id, eventDate: event_date!, eventType: event_type!,
        notificationType: 'schedule_changed', changeId: randomUUID(),
      })
      const processed = await processScheduleEmailQueue(200)
      notification = { queued: queued.queued, processed: processed.processed, sent: processed.sent, failed: processed.failed, skipped: processed.skipped }
    } catch (notifyError) {
      notificationError = notifyError instanceof Error ? notifyError.message : 'Falha ao enfileirar avisos.'
      console.error('Falha ao notificar alteração de ensaio:', notifyError)
    }
  }
  const calendar = await reconcileMinistersForQuarter(quarter_id).catch(syncError => ({
    ministers: 0,
    errors: [{ ministerId: '', error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' }],
  }))

  return NextResponse.json({ rehearsal: data, notification, notification_error: notificationError, calendar_sync: calendar })
}
