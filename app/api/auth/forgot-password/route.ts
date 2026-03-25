import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/routes'
import crypto from 'crypto'
import { Resend } from 'resend'

type ForgotPasswordPayload = {
  email?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ForgotPasswordPayload
    const email = body.email?.trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 })
    }

    // Use the current request origin as redirect target (must be app origin)
    // Ex: https://app.example.com/auth/set-password
    const origin = (request as any).nextUrl?.origin || process.env.NEXT_PUBLIC_APP_URL || ''

    if (!origin) {
      return NextResponse.json(
        { error: 'App origin desconhecida. Configure NEXT_PUBLIC_APP_URL.' },
        { status: 500 },
      )
    }

    // Gera token e armazena no banco
    const token = crypto.randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30) // 30 minutos

    const supabaseAdmin = createAdminClient()

    // tenta localizar user_id pelo email
    let userId: string | null = null
    try {
      const listRes = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 })
      const users = (listRes as any)?.data?.users || (listRes as any)?.users || []
      const found = users.find((u: any) => u.email?.toLowerCase() === email)
      if (found) userId = found.id
    } catch (e) {
      console.log('[api/forgot-password] listUsers failed', e)
    }

    // Armazena token
    const { error: insertError } = await supabaseAdmin
      .from('password_resets')
      .insert({ token, user_id: userId, email, expires_at: expiresAt })

    if (insertError) {
      console.error('[api/forgot-password] insert token error', insertError)
      return NextResponse.json({ error: 'Erro ao gerar link de redefinição.' }, { status: 500 })
    }

    // Use path-based token to improve compatibility with mobile/webviews
    const resetUrl = `${origin}${ROUTES.AUTH_RESET}/${token}`
    console.log('[api/forgot-password] resetUrl=', resetUrl)
    // Envia e-mail via Resend se configurado
    const resendApiKey = process.env.RESEND_API_KEY
    // Prefer full `Name <email>` in `RESEND_FROM`. Fall back to `RESEND_FROM_EMAIL` if present.
    const resendFromEnv = process.env.RESEND_FROM
    const resendFromEmailEnv = process.env.RESEND_FROM_EMAIL
    const resendFrom = resendFromEnv || (resendFromEmailEnv ? `Worship Flow <${resendFromEmailEnv}>` : `no-reply@${new URL(origin).hostname}`)

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey)
        const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:'Inter', 'Segoe UI', Arial, sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,0.08);overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 8px 24px;text-align:center;">
                <img src="https://worship-flow-kappa.vercel.app/logo.jpg" alt="Worship Flow" width="56" height="56" style="border-radius:12px;border:1px solid #eef0f4;object-fit:cover;" />
                <div style="margin-top:10px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Segurança da conta</div>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 24px 0 24px;text-align:center;">
                <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">Redefinir senha</h1>
                <p style="margin:10px 0 0 0;font-size:14px;color:#475569;line-height:1.5;">
                  Recebemos um pedido para redefinir a senha da sua conta.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px 8px 24px;text-align:center;">
                <a href="${resetUrl}"
                   style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">
                  Escolher nova senha
                </a>
                <p style="margin:12px 0 0 0;font-size:13px;color:#6b7280;">
                  O link é válido por 30 minutos. Se expirar, peça outro pelo app.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px 22px 24px;font-size:12px;color:#6b7280;line-height:1.6;">
                <p style="margin:0 0 8px 0;">Se você não solicitou esta alteração, ignore este e-mail.</p>
                <p style="margin:0;">Dúvidas? Entre em contato diretamente com o suporte técnico.</p>
                <p style="margin:10px 0 0 0;color:#94a3b8;">Worship Flow · Segurança</p>
              </td>
            </tr>
          </table>
          <div style="font-size:11px;color:#94a3b8;margin-top:14px;">Você recebeu este e-mail porque alguém solicitou redefinir a senha dessa conta.</div>
        </td>
      </tr>
    </table>
  </body>
</html>`

        const sendRes = await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: 'Redefina sua senha — Worship Flow',
          html,
        })
        console.log('[api/forgot-password] email sent via Resend to', email, 'resendResponse=', sendRes)
      } catch (e) {
        console.error('[api/forgot-password] Resend send failed', e)
        // retornamos o resetUrl no corpo para facilitar testes locais
        return NextResponse.json({ ok: true, resetUrl, warning: 'resend_failed' })
      }
    }

    // Nota: em dev retornamos o link no corpo para facilitar testes.
    return NextResponse.json({ ok: true, resetUrl })
  } catch {
    return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 })
  }
}