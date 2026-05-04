import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueBimesterPublishedNotifications } from '@/lib/notifications/schedule-email'

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('x-cron-secret')
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return header === secret || bearer === secret
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    const { data: publishedBimester, error } = await admin
      .from('schedule_quarters')
      .select('id, name')
      .eq('is_published', true)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (!publishedBimester) {
      return NextResponse.json({ ok: true, queued: 0, message: 'Nenhuma escala publicada encontrada.' })
    }

    const result = await enqueueBimesterPublishedNotifications({
      bimesterId: publishedBimester.id,
      bimesterName: publishedBimester.name,
    })

    return NextResponse.json({
      ok: true,
      queued: result.queued,
      quarter: publishedBimester,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao enfileirar notificações da escala publicada'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}