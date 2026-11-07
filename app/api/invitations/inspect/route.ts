import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { invitationErrorResponse, noStoreHeaders } from '@/lib/invitations/api'
import { inspectInvitation } from '@/lib/invitations/server'

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
}).strict()

// Inspection is a POST so that a mail scanner following the link cannot consume
// the invitation, and it never mutates state. The raw token is not logged. The
// session is read only to report whether it matches the invitation e-mail.
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Este convite não está mais disponível.' }, { status: 404 })
    }
    const user = await getAuthenticatedIdentity()
    const inspection = await inspectInvitation(body.data.token, user?.email ?? null)
    return NextResponse.json({ invitation: inspection }, { headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
