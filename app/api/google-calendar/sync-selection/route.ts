import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { enableChurchSync, hasCredentialForUser } from '@/lib/google-calendar/client'
import { disconnectChurchSync, reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ churchId: request.headers.get('x-wf-church-id') })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE })
    }
    throw error
  }

  if (context.isImpersonating) {
    return NextResponse.json(
      { error: 'Conexões pessoais não podem ser alteradas em contexto de suporte.' },
      { status: 403, headers: NO_STORE }
    )
  }

  let enabled: unknown
  try {
    enabled = (await request.json())?.enabled
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400, headers: NO_STORE })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Informe enabled como booleano.' }, { status: 400, headers: NO_STORE })
  }

  try {
    if (!enabled) {
      await disconnectChurchSync(context.ministerId)
      return NextResponse.json({ success: true, syncEnabled: false }, { headers: NO_STORE })
    }

    if (!(await hasCredentialForUser(context.userId))) {
      return NextResponse.json(
        { error: 'Conecte sua conta Google antes de sincronizar esta igreja.' },
        { status: 409, headers: NO_STORE }
      )
    }

    await enableChurchSync(context.userId, context.churchId, context.ministerId)
    await reconcileMinisterCalendar(context.ministerId)
    return NextResponse.json({ success: true, syncEnabled: true }, { headers: NO_STORE })
  } catch (error) {
    console.error('Error updating Google Calendar church sync:', error)
    return NextResponse.json({ error: 'Não foi possível atualizar a sincronização.' }, { status: 500, headers: NO_STORE })
  }
}
