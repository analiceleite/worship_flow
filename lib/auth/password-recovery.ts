import { z } from 'zod'

const requestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict()
const resetSchema = z.object({
  tokenHash: z.string().regex(/^[a-zA-Z0-9_-]{40,128}$/),
  password: z.string().min(6).max(128),
}).strict()

const neutralResponse = {
  status: 200,
  body: { ok: true, message: 'Se houver uma conta elegível, você receberá um e-mail com as instruções.' },
}
const unavailable = {
  status: 503,
  body: { error: 'Não foi possível processar a solicitação agora. Tente novamente mais tarde.' },
}

type Result = { status: number; body: { ok?: boolean; message?: string; error?: string } }
type Dependencies = {
  origin: string
  allow: (scope: string, subject: string, limit: number) => Promise<boolean>
  generate: (email: string) => Promise<string | null>
  send: (email: string, url: string) => Promise<void>
  report: (event: 'request_failed' | 'delivery_failed') => void
}

// Never derive the destination of a recovery email from Host/Origin headers.
export function recoveryOrigin(baseUrl: string | undefined, production: boolean): string {
  if (!baseUrl) throw new Error('Recovery origin is not configured')
  const url = new URL(baseUrl)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production))) {
    throw new Error('Invalid recovery origin')
  }
  return url.origin
}

export function localRecoveryMail(enabled: boolean, production: boolean, origin: string, supabaseUrl: string | undefined): boolean {
  if (!enabled) return false
  const api = new URL(supabaseUrl || '')
  const localHost = ['localhost', '127.0.0.1', '[::1]']
  const app = new URL(origin)
  if (production || !localHost.includes(api.hostname) || api.protocol !== 'http:' || api.port !== '54321' ||
      api.pathname !== '/' || api.username || api.password || api.search || api.hash ||
      !localHost.includes(app.hostname) || app.protocol !== 'http:' || app.port !== '3001') {
    throw new Error('Local email capture requires an isolated local development stack')
  }
  return true
}

export async function requestPasswordRecovery(payload: unknown, deps: Dependencies): Promise<Result> {
  const parsed = requestSchema.safeParse(payload)
  if (!parsed.success) return { status: 400, body: { error: 'Informe um e-mail válido.' } }

  try {
    // Persistent, atomic limits shared by all instances. Suppression is deliberately neutral.
    if (!await deps.allow('request-global', 'all', 100) ||
        !await deps.allow('request-email', parsed.data.email, 3)) return neutralResponse

    const tokenHash = await deps.generate(parsed.data.email)
    if (!tokenHash) return neutralResponse

    // Fragments are not sent in HTTP requests, access logs or Referer headers.
    const url = new URL('/auth/reset', deps.origin)
    url.hash = new URLSearchParams({ token_hash: tokenHash }).toString()
    try {
      await deps.send(parsed.data.email, url.toString())
    } catch {
      deps.report('delivery_failed')
    }
    // Do not disclose account eligibility or email delivery outcomes.
    return neutralResponse
  } catch {
    deps.report('request_failed')
    return unavailable
  }
}

export type ResetOutcome = 'success' | 'invalid' | 'password_rejected' | 'unavailable'

export async function resetPassword(payload: unknown, deps: {
  allow: (scope: string, subject: string, limit: number) => Promise<boolean>
  verifyAndUpdate: (tokenHash: string, password: string) => Promise<ResetOutcome>
}): Promise<Result> {
  const parsed = resetSchema.safeParse(payload)
  if (!parsed.success) return { status: 400, body: { error: 'Link ou senha inválidos. Use uma senha de 6 a 128 caracteres.' } }

  try {
    if (!await deps.allow('reset-global', 'all', 300)) {
      return { status: 429, body: { error: 'Muitas tentativas. Tente novamente mais tarde.' } }
    }
    // Do not depend on the provider serializing two simultaneous OTP exchanges.
    // Reserve the attempt atomically across application instances before Auth.
    if (!await deps.allow('reset-proof', parsed.data.tokenHash, 1)) {
      return { status: 400, body: { error: 'Este link já teve uma tentativa de uso. Solicite um novo link.' } }
    }
    const outcome = await deps.verifyAndUpdate(parsed.data.tokenHash, parsed.data.password)
    if (outcome === 'success') return { status: 200, body: { ok: true } }
    if (outcome === 'unavailable') return unavailable
    return {
      status: 400,
      body: { error: outcome === 'invalid'
        ? 'Link inválido, expirado ou já utilizado. Solicite um novo link.'
        : 'Não foi possível usar essa senha. Solicite um novo link e escolha outra senha que atenda à política da conta.' },
    }
  } catch {
    return unavailable
  }
}

// Bound unauthenticated JSON input before buffering it in memory.
export async function readRecoveryPayload(request: Request): Promise<unknown> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
