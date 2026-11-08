import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import {
  enqueueBimesterPublishedNotifications,
  enqueueBimesterUnpublishedNotifications,
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
    .select('id, name, is_published, publication_revision')
    .eq('id', id)
    .eq('church_id', context.churchId)
    .maybeSingle()

  if (targetQuarterError) {
    return NextResponse.json({ error: targetQuarterError.message }, { status: 500 })
  }

  if (!targetQuarter) {
    return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
  }

  if (targetQuarter.is_published === isPublished) {
    return NextResponse.json({ quarter: targetQuarter, unchanged: true, notifications: { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }, notification_error: null, calendar_sync: { errors: [] } })
  }

  const previousPublishedRes = isPublished
    ? await adminSupabase.from('schedule_quarters')
      .select('id, church_id, name, publication_revision')
      .eq('church_id', context.churchId).eq('is_published', true).neq('id', id)
    : { data: [], error: null }
  if (previousPublishedRes.error) {
    return NextResponse.json({ error: previousPublishedRes.error.message }, { status: 500 })
  }
  const previousPublished = previousPublishedRes.data ?? []

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
    .update({
      is_published: isPublished,
      ...(isPublished ? { publication_revision: (targetQuarter.publication_revision ?? 0) + 1 } : {}),
    })
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('id, church_id, name, start_date, end_date, is_published, created_at, publication_revision')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Erro ao atualizar publicação' },
      { status: 500 }
    )
  }

  let notifications = { queued: 0, processed: 0, sent: 0, failed: 0, skipped: 0 }
  let notificationError: string | null = null
  try {
    if (isPublished) {
      const enqueueResult = await enqueueBimesterPublishedNotifications({
        bimesterId: data.id,
        bimesterName: data.name,
        churchId: context.churchId,
        publicationRevision: data.publication_revision,
      })
      notifications.queued += enqueueResult.queued
    } else {
      const enqueueResult = await enqueueBimesterUnpublishedNotifications({
        bimesterId: data.id,
        bimesterName: data.name,
        churchId: context.churchId,
        publicationRevision: targetQuarter.publication_revision ?? 0,
      })
      notifications.queued += enqueueResult.queued
    }
    for (const previous of previousPublished as Array<{ id: string; name: string; church_id: string; publication_revision: number }>) {
      const { error: unpublishError } = await adminSupabase.from('schedule_quarters')
        .update({ is_published: false })
        .eq('id', previous.id).eq('church_id', context.churchId)
      if (unpublishError) throw new Error(unpublishError.message)
      const enqueueResult = await enqueueBimesterUnpublishedNotifications({
        bimesterId: previous.id,
        bimesterName: previous.name,
        churchId: context.churchId,
        publicationRevision: previous.publication_revision ?? 0,
      })
      notifications.queued += enqueueResult.queued
    }
    if (notifications.queued > 0) {
      const processResult = await processScheduleEmailQueue(200)
      notifications = {
        ...notifications,
        processed: processResult.processed,
        sent: processResult.sent,
        failed: processResult.failed,
        skipped: processResult.skipped,
      }
    }
  } catch (enqueueError) {
    notificationError = enqueueError instanceof Error ? enqueueError.message : 'Falha ao enfileirar notificações.'
    console.error('Erro ao enfileirar notificações de escala:', enqueueError)
  }

  const syncQuarterIds = [...new Set([data.id, ...previousPublished.map((quarter: { id: string }) => quarter.id)])]
  const calendarErrors = [] as Array<{ quarterId: string; error: string }>
  for (const quarterId of syncQuarterIds) {
    try {
      const result = await reconcileMinistersForQuarter(quarterId)
      calendarErrors.push(...result.errors.map(item => ({ quarterId, error: item.error })))
    } catch (syncError) {
      calendarErrors.push({ quarterId, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
    }
  }

  return NextResponse.json({ quarter: data, notifications, notification_error: notificationError, calendar_sync: { errors: calendarErrors } })
}
