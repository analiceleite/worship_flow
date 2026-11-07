import { NextResponse } from 'next/server'
import { processInvitationOutbox } from '@/lib/invitations/server'

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
    ? Math.max(1, Math.min(100, Math.trunc(requestedBatchSize)))
    : 20
  try {
    const result = await processInvitationOutbox(batchSize)
    return NextResponse.json({ ok: true, batchSize, ...result })
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar convites.' }, { status: 503 })
  }
}
