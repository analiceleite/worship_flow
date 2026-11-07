import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { disconnectChurchSync, disconnectUserAccount } from '@/lib/google-calendar/reconcile'

export async function POST(request: Request) {
  let context
  try {
    context = await getCurrentMinisterContext({ churchId: request.headers.get('x-wf-church-id') })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    }
    throw error
  }

  if (context.isImpersonating) {
    return NextResponse.json(
      { error: 'Conexões pessoais não podem ser alteradas em contexto de suporte.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  let scope: 'account' | 'church' = 'account'
  try {
    const body = await request.json()
    if (body?.scope === 'church') scope = 'church'
  } catch {
    // No body means the historical account-wide action.
  }

  try {
    if (scope === 'church') {
      await disconnectChurchSync(context.ministerId)
    } else {
      await disconnectUserAccount(context.userId)
    }
    return NextResponse.json({ success: true, scope }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
