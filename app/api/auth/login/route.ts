import { NextResponse } from 'next/server'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { clientIp } from '@/lib/auth/client-ip'
import { LOGIN_INVALID_MESSAGE, LOGIN_LIMITED_MESSAGE, loginSchema, signInWithPassword } from '@/lib/auth/login-server'

const noStore = { 'Cache-Control': 'no-store' }

// WF-46: the session cookies are set by this response, the same way the browser client reads them.
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403, headers: noStore })
    }
    const body = loginSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: LOGIN_INVALID_MESSAGE }, { status: 400, headers: noStore })
    }
    const outcome = await signInWithPassword(body.data, clientIp(request))
    if (outcome.kind === 'ok') {
      return NextResponse.json({ emailConfirmed: outcome.emailConfirmed }, { status: 200, headers: noStore })
    }
    if (outcome.kind === 'limited') {
      return NextResponse.json({ error: LOGIN_LIMITED_MESSAGE }, { status: 429, headers: noStore })
    }
    if (outcome.kind === 'invalid') {
      return NextResponse.json({ error: LOGIN_INVALID_MESSAGE }, { status: 401, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível entrar agora. Tente novamente.' }, { status: 503, headers: noStore })
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar agora. Tente novamente.' }, { status: 503, headers: noStore })
  }
}
