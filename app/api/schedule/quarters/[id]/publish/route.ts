import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  enqueueQuarterPublishedNotifications,
  processScheduleEmailQueue,
} from '@/lib/notifications/schedule-email'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const isPublished = body?.is_published !== false

  const adminSupabase = createAdminClient()

  if (isPublished) {
    const { error: resetError } = await adminSupabase
      .from('schedule_quarters')
      .update({ is_published: false })
      .neq('id', id)

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }
  }

  const { data, error } = await adminSupabase
    .from('schedule_quarters')
    .update({ is_published: isPublished })
    .eq('id', id)
    .select('id, name, start_date, end_date, is_published, created_at')
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
      const enqueueResult = await enqueueQuarterPublishedNotifications({
        quarterId: data.id,
        quarterName: data.name,
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

  return NextResponse.json({ quarter: data, notifications })
}
