import { NextResponse } from 'next/server'
import { readRecoveryPayload, requestPasswordRecovery } from '@/lib/auth/password-recovery'
import { recoveryDependencies } from '@/lib/auth/password-recovery-server'

export async function POST(request: Request) {
  try {
    const payload = await readRecoveryPayload(request)
    const result = await requestPasswordRecovery(payload, recoveryDependencies())
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[password-recovery] configuration_unavailable')
    return NextResponse.json({ error: 'Serviço temporariamente indisponível. Tente novamente mais tarde.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
