import { NextResponse } from 'next/server'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { publicSignupSchema } from '@/lib/onboarding/rules'
import { PublicSignupError, signupChurchOwner } from '@/lib/onboarding/signup'
import { publicChurchCreationEnabled } from '@/lib/onboarding/flags'

const noStore = { 'Cache-Control': 'no-store' }

// Same answer for new and existing e-mails, so the public form cannot enumerate accounts.
export async function POST(request: Request) {
  try {
    if (!publicChurchCreationEnabled()) {
      return NextResponse.json({ error: 'Não disponível no momento.' }, { status: 404, headers: noStore })
    }
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403, headers: noStore })
    }
    const body = publicSignupSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Informe seu nome, um e-mail válido e uma senha com pelo menos 8 caracteres.' }, { status: 400, headers: noStore })
    }
    await signupChurchOwner(body.data)
    return NextResponse.json({ email: body.data.email, confirmationRequired: true }, { status: 202, headers: noStore })
  } catch (error) {
    if (error instanceof PublicSignupError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível criar sua conta agora.' }, { status: 503, headers: noStore })
  }
}
