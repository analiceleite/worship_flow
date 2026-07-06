import { NextResponse } from 'next/server'
import { enqueueOffsetReminderNotifications } from '@/lib/notifications/schedule-email'

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
  // Permite simular "now" em testes manuais (curl), sem depender do horário real do relógio.
  const nowOverride = typeof body?.now === 'string' && !Number.isNaN(Date.parse(body.now))
    ? new Date(body.now)
    : undefined

  try {
    const result = await enqueueOffsetReminderNotifications({ now: nowOverride })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao enfileirar lembretes'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
