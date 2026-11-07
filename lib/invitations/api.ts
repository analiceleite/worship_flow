import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import type { CurrentMinisterContext } from '@/lib/types'
import { invitationError } from './errors'

// Invitations are a local operation. Platform support impersonation must never
// create, resend, revoke or inspect a church's invitations.
export async function getInvitationAdminContext(): Promise<CurrentMinisterContext> {
  const context = await getCurrentMinisterContext({ requireAdmin: true })
  if (context.isImpersonating) {
    throw new AuthContextError('Encerre o contexto de suporte para gerenciar convites.', 403)
  }
  return context
}

export function invitationErrorResponse(error: unknown) {
  if (error instanceof AuthContextError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  const mapped = invitationError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

export const noStoreHeaders = { 'Cache-Control': 'no-store' }
