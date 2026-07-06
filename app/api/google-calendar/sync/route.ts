import { NextResponse } from 'next/server'
import { reconcileAllConnectedMinisters } from '@/lib/google-calendar/reconcile'

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
    const result = await reconcileAllConnectedMinisters()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao sincronizar Google Calendar'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
