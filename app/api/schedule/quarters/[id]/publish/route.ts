import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import {
  enqueueBimesterPublishedNotifications,
  processScheduleEmailQueue,
} from '@/lib/notifications/schedule-email'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let context
  try {
    context = await getCurrentMinisterContext({ requireAdmin: true })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const body = await request.json().catch(() => ({}))
  const isPublished = body?.is_published !== false

  const adminSupabase = createAdminClient()

  const { data: targetQuarter, error: targetQuarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id')
    .eq('id', id)
    .eq('church_id', context.churchId)
    .maybeSingle()

  if (targetQuarterError) {
    return NextResponse.json({ error: targetQuarterError.message }, { status: 500 })
  }

  if (!targetQuarter) {
    return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
  }

  if (isPublished) {
    const { error: resetError } = await adminSupabase
      .from('schedule_quarters')
      .update({ is_published: false })
      .eq('church_id', context.churchId)
      .neq('id', id)

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }
  }

  const { data, error } = await adminSupabase
    .from('schedule_quarters')
    .update({ is_published: isPublished })
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('id, church_id, name, start_date, end_date, is_published, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Erro ao atualizar publicação' },
      { status: 500 }
    )
  }

  let notifications = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  if (isPublished) {
    try {
      const enqueueResult = await enqueueBimesterPublishedNotifications({
        bimesterId: data.id,
        bimesterName: data.name,
      })

      const processResult = await processScheduleEmailQueue(200)
      notifications = {
        queued: enqueueResult.queued,
        processed: processResult.processed,
        sent: processResult.sent,
        failed: processResult.failed,
        skipped: processResult.skipped,
      }
    } catch (enqueueError) {
      console.error('Erro ao enfileirar notificações de escala:', enqueueError)
    }
  }

  try {
    await reconcileMinistersForQuarter(data.id)
  } catch (syncError) {
    console.error('Erro ao sincronizar Google Calendar após publicação/despublicação:', syncError)
  }

  return NextResponse.json({ quarter: data, notifications })
}
