import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

function invitationSecret(): string {
  const secret = process.env.INVITATION_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Invitation secret is not configured')
  return secret
}

function invitationKey(): Buffer {
  return createHash('sha256').update(invitationSecret()).digest()
}

export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

// Only this HMAC is persisted. The raw bearer token exists in the email link and
// transiently in the outbox ciphertext, never in logs or audit rows.
export function hashInvitationToken(token: string): string {
  return createHmac('sha256', invitationSecret()).update(token).digest('hex')
}

export function invitationRateLimitKey(scope: string, subject: string): string {
  return createHmac('sha256', invitationSecret()).update(`wf04:${scope}:${subject}`).digest('hex')
}

export function encryptInvitationToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', invitationKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

export function decryptInvitationToken(value: string): string {
  const data = Buffer.from(value, 'base64url')
  if (data.length < 29) throw new Error('Invalid invitation payload')
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', invitationKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
