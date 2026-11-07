import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { getImpersonatedChurchId } from '@/lib/auth-context'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { invitationErrorResponse, noStoreHeaders } from '@/lib/invitations/api'
import { acceptInvitation } from '@/lib/invitations/server'

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
}).strict()

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedIdentity()
    if (!user) return NextResponse.json({ error: 'Entre na conta que recebeu o convite.' }, { status: 401 })
    if (await getImpersonatedChurchId()) {
      return NextResponse.json({ error: 'Encerre o contexto de suporte para aceitar um convite.' }, { status: 403 })
    }
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Este convite não está mais disponível.' }, { status: 404 })
    }
    const acceptance = await acceptInvitation({ actorUserId: user.id, token: body.data.token })
    return NextResponse.json({ acceptance }, { headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
