import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { invitationErrorResponse, noStoreHeaders } from '@/lib/invitations/api'
import { signupWithInvitation } from '@/lib/invitations/server'

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,128}$/),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(6).max(128),
}).strict()

// Creates an unconfirmed Auth identity for a valid invitation. The person must
// confirm the e-mail through Supabase, then sign in and accept the invitation,
// which verifies the confirmed e-mail against the invitation e-mail.
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const body = schema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Informe seu nome e uma senha com pelo menos 6 caracteres.' }, { status: 400 })
    }
    const created = await signupWithInvitation(body.data)
    return NextResponse.json({ email: created.email, confirmationRequired: true }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
