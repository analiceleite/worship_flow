import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { serverSupabaseFetch } from '@/lib/supabase/server-fetch'
import { localRecoveryMail, recoveryOrigin, type ResetOutcome } from './password-recovery'

export function recoveryDependencies() {
  const origin = recoveryOrigin(process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV === 'production')
  const local = localRecoveryMail(process.env.LOCAL_SUPABASE === 'true', process.env.NODE_ENV === 'production', origin, process.env.NEXT_PUBLIC_SUPABASE_URL)
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL
  if (!secret || (!local && (!resendKey || !from))) throw new Error('Recovery is not configured')
  const admin = createAdminClient()
  const resend = local ? null : new Resend(resendKey)

  return {
    origin,
    allow: recoveryLimiter(),
    async generate(email: string): Promise<string | null> {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
      if (error) {
        if (error.status === 404 || error.code === 'user_not_found') return null
        throw new Error('Recovery generation failed')
      }
      if (!data.properties?.hashed_token) throw new Error('Recovery generation failed')
      return data.properties.hashed_token
    },
    async send(email: string, url: string) {
      const subject = 'Redefina sua senha — Worship Flow'
      const text = `Recebemos um pedido para redefinir sua senha no Worship Flow.\n\nAbra o link para escolher uma nova senha:\n${url}\n\nO link tem validade limitada e só pode ser utilizado uma vez. Se não solicitou a alteração, ignore este e-mail.`
        // Keep secrets out of third-party click tracking and decorative remote assets.
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;line-height:1.6"><h1 style="font-size:24px">Redefinir senha</h1><p>Recebemos um pedido para redefinir sua senha no Worship Flow.</p><p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#18181b;color:#fff;border-radius:8px">Escolher nova senha</a></p><p>O link tem validade limitada e só pode ser utilizado uma vez.</p><p>Se não solicitou a alteração, ignore este e-mail.</p></div>`
      if (local) {
        const mailpit = process.env.LOCAL_MAILPIT_URL === 'http://mailpit:8025' && process.env.SUPABASE_INTERNAL_URL === 'http://gateway:8000'
          ? 'http://mailpit:8025' : 'http://127.0.0.1:54324'
        const response = await fetch(`${mailpit}/api/v1/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ From: { Email: 'no-reply@worship.local.test', Name: 'Worship Flow LOCAL' },
            To: [{ Email: email }], Subject: subject, Text: text, HTML: html }),
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) throw new Error('Local email capture failed')
        return
      }
      if (!resend || !from) throw new Error('Recovery delivery is not configured')
      const { error } = await resend.emails.send({ from, to: email, subject, text, html })
      if (error) throw new Error('Recovery delivery failed')
    },
    report(event: 'request_failed' | 'delivery_failed') {
      console.error(`[password-recovery] ${event}`)
    },
  }
}

export function recoveryLimiter() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Recovery is not configured')
  const admin = createAdminClient()
  return async (scope: string, subject: string, limit: number): Promise<boolean> => {
    // Store no raw email, token or password in the limiter.
    const key = createHmac('sha256', secret).update(`${scope}:${subject}`).digest('hex')
    const { data, error } = await admin.rpc('consume_password_recovery_limit', { p_key: key, p_limit: limit })
    if (error || typeof data !== 'boolean') throw new Error('Recovery limiter unavailable')
    return data
  }
}

export async function verifyAndUpdatePassword(tokenHash: string, password: string): Promise<ResetOutcome> {
  // A new non-persistent ANON client per request. Never reuse a signed-in admin
  // client or accept ambient browser cookies as recovery authorization.
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: serverSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
  if (error) return error.status && error.status >= 500 ? 'unavailable' : 'invalid'
  if (!data.session || !data.user) return 'invalid'

  try {
    // Supabase Auth consumes the recovery proof and authorizes the password update.
    const { error: updateError } = await client.auth.updateUser({ password })
    if (!updateError) return 'success'
    return updateError.status && updateError.status >= 500 ? 'unavailable' : 'password_rejected'
  } finally {
    // Do not expose or persist the temporary recovery session in the browser.
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}
