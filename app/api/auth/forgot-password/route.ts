import { NextResponse } from 'next/server'
import { readRecoveryPayload, requestPasswordRecovery } from '@/lib/auth/password-recovery'
import { recoveryDependencies, recoveryLimiter } from '@/lib/auth/password-recovery-server'
import { clientIp } from '@/lib/auth/client-ip'

export async function POST(request: Request) {
  try {
    // WF-46: per-address limit. Same generic answer as the e-mail limits; reveals nothing about accounts.
    if (!await recoveryLimiter()('request-ip', clientIp(request), 30)) {
      return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, {
        status: 429, headers: { 'Cache-Control': 'no-store' },
      })
    }
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
