import { NextResponse } from 'next/server'
import { readRecoveryPayload, resetPassword } from '@/lib/auth/password-recovery'
import { recoveryLimiter, verifyAndUpdatePassword } from '@/lib/auth/password-recovery-server'

export async function POST(request: Request) {
  try {
    const payload = await readRecoveryPayload(request)
    const result = await resetPassword(payload, { allow: recoveryLimiter(), verifyAndUpdate: verifyAndUpdatePassword })
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[password-recovery] reset_unavailable')
    return NextResponse.json({ error: 'Serviço temporariamente indisponível. Tente novamente mais tarde.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
