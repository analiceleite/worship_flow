import { NextResponse } from 'next/server'
import { enqueueReminder1DayNotifications } from '@/lib/notifications/schedule-email'

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('x-cron-secret')
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return header === secret || bearer === secret
}

function getTargetDateISO() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const targetDate = typeof body?.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
    ? body.targetDate
    : getTargetDateISO()

  try {
    const result = await enqueueReminder1DayNotifications(targetDate)
    return NextResponse.json({ ok: true, targetDate, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao enfileirar lembretes de 1 dia'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
