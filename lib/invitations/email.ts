import type { InvitationRole } from './types'

export function invitationOrigin(baseUrl: string | undefined, production: boolean): string {
  if (!baseUrl) throw new Error('Invitation origin is not configured')
  const url = new URL(baseUrl)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production))) {
    throw new Error('Invalid invitation origin')
  }
  return url.origin
}

export function localInvitationMail(
  enabled: boolean,
  production: boolean,
  origin: string,
  supabaseUrl: string | undefined,
): boolean {
  if (!enabled) return false
  if (production) throw new Error('Local invitation capture cannot run in production')
  const localHost = ['localhost', '127.0.0.1', '[::1]']
  const api = new URL(supabaseUrl || '')
  const app = new URL(origin)
  if (!localHost.includes(api.hostname) || api.protocol !== 'http:' || api.port !== '54321' ||
      api.pathname !== '/' || api.username || api.password || api.search || api.hash ||
      !localHost.includes(app.hostname) || app.protocol !== 'http:' || app.port !== '3001') {
    throw new Error('Local email capture requires an isolated local development stack')
  }
  return true
}

export function invitationRoleLabel(role: InvitationRole): string {
  return role === 'admin' ? 'Administrador' : role === 'midia' ? 'Mídia' : 'Integrante'
}

export function invitationUrl(origin: string, token: string): string {
  return new URL(`/auth/invite/${encodeURIComponent(token)}`, origin).toString()
}

export async function sendInvitationEmail(input: {
  to: string
  churchName: string
  role: InvitationRole
  instrument: string
  inviteUrl: string
}): Promise<void> {
  const subject = `Convite para ${input.churchName} — Worship Flow`
  const role = invitationRoleLabel(input.role)
  const functionLabel = input.role === 'midia' ? 'Mídia' : input.instrument
  const text = [
    `Você recebeu um convite para participar de ${input.churchName} no Worship Flow.`,
    '',
    `Função: ${role}${functionLabel ? ` (${functionLabel})` : ''}`,
    '',
    `Abra o link para entrar ou criar sua conta:`,
    input.inviteUrl,
    '',
    'O convite tem validade limitada. Se você não esperava este e-mail, ignore a mensagem.',
  ].join('\n')
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;line-height:1.6">` +
    `<h1 style="font-size:24px">Convite para ${escapeHtml(input.churchName)}</h1>` +
    `<p>Você recebeu um convite para participar de <strong>${escapeHtml(input.churchName)}</strong> no Worship Flow.</p>` +
    `<p>Função: <strong>${escapeHtml(role)}</strong>${functionLabel ? ` · ${escapeHtml(functionLabel)}` : ''}</p>` +
    `<p><a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;padding:12px 20px;background:#18181b;color:#fff;border-radius:8px">Aceitar convite</a></p>` +
    `<p>O convite tem validade limitada. Se você não esperava este e-mail, ignore a mensagem.</p>` +
    `</div>`

  const origin = invitationOrigin(
    process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL,
    process.env.NODE_ENV === 'production',
  )
  const local = localInvitationMail(
    process.env.LOCAL_SUPABASE === 'true',
    process.env.NODE_ENV === 'production',
    origin,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
  const testRecipient = (process.env.INVITATION_EMAIL_TEST_RECIPIENT || process.env.SCHEDULE_EMAIL_TEST_RECIPIENT || '').trim()
  const recipient = local ? input.to : (testRecipient || input.to)

  if (local) {
    const mailpit = process.env.LOCAL_MAILPIT_URL === 'http://mailpit:8025' &&
      process.env.SUPABASE_INTERNAL_URL === 'http://gateway:8000'
      ? 'http://mailpit:8025'
      : 'http://127.0.0.1:54324'
    const response = await fetch(`${mailpit}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: 'no-reply@worship.local.test', Name: 'Worship Flow LOCAL' },
        To: [{ Email: recipient }],
        Subject: subject,
        Text: text,
        HTML: html,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Local invitation email capture failed')
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) throw new Error('Invitation email delivery is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [recipient], subject, text, html }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Invitation email delivery failed (${response.status})`)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] as string))
}
