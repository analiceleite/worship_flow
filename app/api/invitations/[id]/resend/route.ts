import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { getInvitationAdminContext, invitationErrorResponse, noStoreHeaders } from '@/lib/invitations/api'
import { resendInvitation } from '@/lib/invitations/server'

const idSchema = z.string().uuid()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getInvitationAdminContext()
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const { id } = await params
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Convite inválido.' }, { status: 400 })
    }
    const rotated = await resendInvitation({
      actorUserId: context.userId,
      churchId: context.churchId,
      invitationId: id,
    })
    return NextResponse.json({
      invitation: {
        id: rotated.invitation_id,
        version: rotated.version,
        expires_at: rotated.expires_at,
      },
      delivery: rotated.delivery,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
