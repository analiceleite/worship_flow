import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { recoveryLimiter } from '@/lib/auth/password-recovery-server'

// WF-46: password sign-in goes through the server so it can be limited by address and by e-mail.
// The limit is applied before Auth is called. Failures use one generic message, so the
// response never says whether an account exists or is unconfirmed.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
}).strict()

export const LOGIN_INVALID_MESSAGE = 'E-mail ou senha inválidos, ou a conta ainda não foi confirmada.'
export const LOGIN_LIMITED_MESSAGE = 'Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.'

export type LoginOutcome =
  | { kind: 'ok'; emailConfirmed: boolean }
  | { kind: 'limited' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }

export async function signInWithPassword(input: { email: string; password: string }, ip: string): Promise<LoginOutcome> {
  const limit = recoveryLimiter()
  // Per address first: a shared network (a church building) is still limited by its own budget.
  if (!await limit('login-ip', ip, 100)) return { kind: 'limited' }
  // Per e-mail for any address, so one account cannot be guessed from many addresses.
  if (!await limit('login-email', input.email, 10)) return { kind: 'limited' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword(input)
  if (error) {
    return error.status && error.status >= 500 ? { kind: 'unavailable' } : { kind: 'invalid' }
  }
  if (!data.user) return { kind: 'invalid' }
  return { kind: 'ok', emailConfirmed: Boolean(data.user.email_confirmed_at) }
}
