import { createAdminClient } from '@/lib/supabase/admin'
import { recoveryLimiter } from '@/lib/auth/password-recovery-server'

// Public account creation for a future church owner. The identity is created
// unconfirmed; the browser then requests Supabase's confirmation e-mail. No church
// exists until the e-mail is confirmed and the owner explicitly creates one.
// The response never reveals whether the e-mail already has an account.

export class PublicSignupError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'PublicSignupError'
  }
}

export async function signupChurchOwner(input: { name: string; email: string; password: string }): Promise<void> {
  const allowed = await recoveryLimiter()('onboarding-signup', input.email, 5)
  if (!allowed) throw new PublicSignupError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.')

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: false,
    user_metadata: { name: input.name },
  })
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new PublicSignupError(503, 'Não foi possível criar sua conta agora. Tente novamente em instantes.')
  }
}
