import { NextResponse } from 'next/server'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'

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

  const body = await request.json().catch(() => ({}))
  const requestedBatchSize = Number(body?.batchSize)
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.min(200, Math.trunc(requestedBatchSize)))
    : 50

  try {
    const result = await processScheduleEmailQueue(batchSize)
    return NextResponse.json({ ok: true, batchSize, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar fila'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
