import { createAdminClient } from '@/lib/supabase/admin'
import {
  createInvitationToken,
  decryptInvitationToken,
  encryptInvitationToken,
  hashInvitationToken,
  invitationRateLimitKey,
} from './crypto'
import {
  invitationOrigin,
  invitationRoleLabel,
  invitationUrl,
  sendInvitationEmail,
} from './email'
import { InvitationError } from './errors'
import { sessionStateFor } from './session'
import type {
  InvitationAcceptance,
  InvitationDeliveryResult,
  InvitationDeliveryStatus,
  InvitationInspection,
  InvitationRole,
  InvitationState,
  InvitationSummary,
} from './types'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DELIVERY_ATTEMPTS = 5

type InvitationRow = {
  id: string
  church_id: string
  email: string
  name: string
  role: InvitationRole
  instrument: string
  token_hash: string
  version: number
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  revoked_at: string | null
  last_sent_at: string | null
  created_at: string
}

type OutboxRow = {
  id: string
  invitation_id: string
  church_id: string
  version: number
  payload_ciphertext: string
  status: InvitationDeliveryStatus
  attempts: number
  available_at: string
  claimed_at: string | null
  last_error: string | null
}

export function normalizeInvitationEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function invitationState(row: Pick<InvitationRow, 'accepted_at' | 'revoked_at' | 'expires_at'>, now = Date.now()): InvitationState {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (Date.parse(row.expires_at) <= now) return 'expired'
  return 'pending'
}

async function enforceRateLimit(scope: string, subject: string, limit: number) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('consume_wf04_invitation_limit', {
    p_key: invitationRateLimitKey(scope, subject),
    p_limit: limit,
  })
  if (error) throw error
  if (data !== true) throw new InvitationError('WF04_RATE_LIMITED', 429, 'Muitas tentativas.')
}

function deliveryErrorCode(error: unknown): string {
  if (error instanceof InvitationError) return error.code
  const message = error instanceof Error ? error.message : ''
  if (message.includes('expired') || message.includes('INVITATION_EXPIRED')) return 'INVITATION_EXPIRED'
  if (message.includes('not configured')) return 'EMAIL_NOT_CONFIGURED'
  if (message.includes('payload')) return 'INVALID_PAYLOAD'
  return 'EMAIL_DELIVERY_FAILED'
}

async function failOutbox(row: OutboxRow, code: string) {
  const admin = createAdminClient()
  const waitMinutes = Math.min(60, Math.max(1, row.attempts * row.attempts))
  await admin.from('wf04_invitation_outbox').update({
    status: 'failed',
    last_error: code,
    available_at: new Date(Date.now() + waitMinutes * 60 * 1000).toISOString(),
  }).eq('id', row.id)
}

async function skipOutbox(row: OutboxRow, code: string) {
  const admin = createAdminClient()
  await admin.from('wf04_invitation_outbox').update({
    status: 'skipped',
    last_error: code,
    claimed_at: null,
  }).eq('id', row.id)
}

export async function deliverInvitationById(outboxId: string): Promise<InvitationDeliveryResult> {
  const admin = createAdminClient()
  const { data: current, error } = await admin.from('wf04_invitation_outbox')
    .select('id, invitation_id, church_id, version, payload_ciphertext, status, attempts, available_at, claimed_at, last_error')
    .eq('id', outboxId).maybeSingle()
  if (error) throw error
  if (!current) return { status: 'skipped', attempts: 0, error: 'MISSING' }

  const row = current as OutboxRow
  if (!['pending', 'failed', 'sending'].includes(row.status)) {
    return { status: row.status, attempts: row.attempts, ...(row.last_error ? { error: row.last_error } : {}) }
  }
  if (row.status === 'sending' && row.claimed_at && Date.now() - Date.parse(row.claimed_at) < 10 * 60 * 1000) {
    return { status: 'sending', attempts: row.attempts }
  }
  if (row.attempts >= MAX_DELIVERY_ATTEMPTS) return { status: 'failed', attempts: row.attempts, error: 'MAX_ATTEMPTS' }

  const { data: claimed, error: claimError } = await admin.from('wf04_invitation_outbox').update({
    status: 'sending',
    attempts: row.attempts + 1,
    claimed_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', row.id).in('status', ['pending', 'failed', 'sending']).select('id, attempts').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return { status: 'skipped', attempts: row.attempts, error: 'CLAIMED_ELSEWHERE' }

  const attempt = row.attempts + 1
  try {
    const token = decryptInvitationToken(row.payload_ciphertext)
    const tokenHash = hashInvitationToken(token)
    const { data: invitation, error: invitationError } = await admin.from('wf04_invitations')
      .select('id, church_id, email, name, role, instrument, token_hash, version, expires_at, accepted_at, accepted_by, revoked_at, last_sent_at, created_at')
      .eq('id', row.invitation_id).maybeSingle()
    if (invitationError) throw invitationError
    const inv = invitation as InvitationRow | null
    if (!inv || inv.token_hash !== tokenHash || inv.version !== row.version ||
        inv.church_id !== row.church_id || inv.accepted_at || inv.revoked_at ||
        Date.parse(inv.expires_at) <= Date.now()) {
      await skipOutbox(row, 'INVITATION_CHANGED')
      return { status: 'skipped', attempts: attempt, error: 'INVITATION_CHANGED' }
    }

    const { data: church, error: churchError } = await admin.from('churches')
      .select('name, status').eq('id', row.church_id).maybeSingle()
    if (churchError) throw churchError
    if (!church || church.status !== 'active') {
      await skipOutbox(row, 'CHURCH_UNAVAILABLE')
      return { status: 'skipped', attempts: attempt, error: 'CHURCH_UNAVAILABLE' }
    }

    const origin = invitationOrigin(
      process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL,
      process.env.NODE_ENV === 'production',
    )
    await sendInvitationEmail({
      to: inv.email,
      churchName: church.name,
      role: inv.role,
      instrument: inv.instrument,
      inviteUrl: invitationUrl(origin, token),
    })

    const sentAt = new Date().toISOString()
    await admin.from('wf04_invitation_outbox').update({
      status: 'sent', sent_at: sentAt, claimed_at: null, last_error: null,
    }).eq('id', row.id)
    await admin.from('wf04_invitations').update({
      last_sent_at: sentAt, updated_at: sentAt,
    }).eq('id', inv.id)
    return { status: 'sent', attempts: attempt }
  } catch (error) {
    const code = deliveryErrorCode(error)
    await failOutbox({ ...row, attempts: attempt }, code)
    return { status: 'failed', attempts: attempt, error: code }
  }
}

export async function processInvitationOutbox(limit = 20) {
  const admin = createAdminClient()
  const { data, error } = await admin.from('wf04_invitation_outbox')
    .select('id, status, attempts, claimed_at')
    .in('status', ['pending', 'failed', 'sending'])
    .lt('attempts', MAX_DELIVERY_ATTEMPTS)
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100))
  if (error) throw error

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of data ?? []) {
    const result = await deliverInvitationById(row.id)
    if (result.status === 'sent') sent += 1
    else if (result.status === 'failed') failed += 1
    else skipped += 1
  }
  return { processed: (data ?? []).length, sent, failed, skipped }
}

export type CreateInvitationInput = {
  actorUserId: string
  churchId: string
  email: string
  name: string
  role: InvitationRole
  instrument: string
}

export async function createInvitation(input: CreateInvitationInput) {
  await enforceRateLimit('create', `${input.churchId}:${normalizeInvitationEmail(input.email)}`, 5)
  const token = createInvitationToken()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString()
  const { data, error } = await createAdminClient().rpc('wf04_create_invitation', {
    p_actor: input.actorUserId,
    p_church: input.churchId,
    p_email: normalizeInvitationEmail(input.email),
    p_name: input.name.trim(),
    p_role: input.role,
    p_instrument: input.instrument.trim(),
    p_token_hash: hashInvitationToken(token),
    p_expires_at: expiresAt,
    p_payload_ciphertext: encryptInvitationToken(token),
  })
  if (error) throw error
  const created = data as {
    outbox_id: string
    invitation_id: string
    church_id: string
    email: string
    name: string
    role: InvitationRole
    instrument: string
    version: number
    expires_at: string
  }
  const delivery = await deliverInvitationById(created.outbox_id)
  return { ...created, delivery }
}

export async function resendInvitation(input: {
  actorUserId: string
  churchId: string
  invitationId: string
}) {
  await enforceRateLimit('resend', `${input.churchId}:${input.invitationId}`, 3)
  const token = createInvitationToken()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString()
  const { data, error } = await createAdminClient().rpc('wf04_rotate_invitation', {
    p_actor: input.actorUserId,
    p_church: input.churchId,
    p_id: input.invitationId,
    p_token_hash: hashInvitationToken(token),
    p_expires_at: expiresAt,
    p_payload_ciphertext: encryptInvitationToken(token),
  })
  if (error) throw error
  const rotated = data as { outbox_id: string; invitation_id: string; version: number; expires_at: string }
  const delivery = await deliverInvitationById(rotated.outbox_id)
  return { ...rotated, delivery }
}

export async function revokeInvitation(input: {
  actorUserId: string
  churchId: string
  invitationId: string
}) {
  const { data, error } = await createAdminClient().rpc('wf04_revoke_invitation', {
    p_actor: input.actorUserId,
    p_church: input.churchId,
    p_id: input.invitationId,
  })
  if (error) throw error
  return data as { invitation_id: string; revoked_at: string }
}

export async function inspectInvitation(token: string, sessionEmail: string | null): Promise<InvitationInspection> {
  const tokenHash = hashInvitationToken(token)
  await enforceRateLimit('inspect', tokenHash, 30)
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('wf04_inspect_invitation', {
    p_token_hash: tokenHash,
  })
  if (error) throw error
  if (!sessionEmail) {
    return { ...(data as Omit<InvitationInspection, 'session_state'>), session_state: 'anonymous' }
  }
  const { data: row, error: emailError } = await admin.from('wf04_invitations')
    .select('email').eq('token_hash', tokenHash).maybeSingle()
  if (emailError) throw emailError
  return {
    ...(data as Omit<InvitationInspection, 'session_state'>),
    session_state: sessionStateFor(sessionEmail, row?.email ?? null),
  }
}

export async function acceptInvitation(input: {
  actorUserId: string
  token: string
}): Promise<InvitationAcceptance> {
  await enforceRateLimit('accept', input.actorUserId, 30)
  const { data, error } = await createAdminClient().rpc('wf04_accept_invitation', {
    p_actor: input.actorUserId,
    p_token_hash: hashInvitationToken(input.token),
  })
  if (error) throw error
  return data as InvitationAcceptance
}

export async function listInvitations(churchId: string): Promise<InvitationSummary[]> {
  const admin = createAdminClient()
  const { data: invitations, error } = await admin.from('wf04_invitations')
    .select('id, church_id, email, name, role, instrument, expires_at, accepted_at, revoked_at, created_at')
    .eq('church_id', churchId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  const rows = (invitations ?? []) as Array<Pick<InvitationRow,
    'id' | 'email' | 'name' | 'role' | 'instrument' | 'expires_at' | 'accepted_at' | 'revoked_at' | 'created_at'>>
  const ids = rows.map(row => row.id)
  if (ids.length === 0) return []

  const { data: outbox, error: outboxError } = await admin.from('wf04_invitation_outbox')
    .select('invitation_id, status, attempts, last_error, sent_at, created_at')
    .in('invitation_id', ids)
    .order('created_at', { ascending: false })
  if (outboxError) throw outboxError
  type DeliveryRow = {
    invitation_id: string
    status: InvitationDeliveryStatus
    attempts: number
    last_error: string | null
    sent_at: string | null
  }
  const latest = new Map<string, DeliveryRow>()
  for (const row of (outbox ?? []) as DeliveryRow[]) {
    if (!latest.has(row.invitation_id)) latest.set(row.invitation_id, row)
  }

  return rows.map(row => {
    const delivery = latest.get(row.id)
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as InvitationRole,
      instrument: row.instrument,
      state: invitationState(row as Pick<InvitationRow, 'accepted_at' | 'revoked_at' | 'expires_at'>),
      expires_at: row.expires_at,
      created_at: row.created_at,
      accepted_at: row.accepted_at,
      revoked_at: row.revoked_at,
      delivery: delivery ? {
        status: delivery.status,
        attempts: delivery.attempts,
        last_error: delivery.last_error,
        sent_at: delivery.sent_at,
      } : null,
    }
  })
}

export async function signupWithInvitation(input: {
  token: string
  name: string
  password: string
}) {
  const tokenHash = hashInvitationToken(input.token)
  await enforceRateLimit('signup', tokenHash, 5)
  const admin = createAdminClient()
  const { data: invitation, error } = await admin.from('wf04_invitations')
    .select('email, name, accepted_at, revoked_at, expires_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (error) throw error
  if (!invitation || invitation.accepted_at || invitation.revoked_at) {
    throw new InvitationError('WF04_INVITATION_UNAVAILABLE', 404, 'Convite indisponível.')
  }
  if (Date.parse(invitation.expires_at) <= Date.now()) {
    throw new InvitationError('WF04_INVITATION_EXPIRED', 410, 'Convite expirado.')
  }

  // The account is created unconfirmed. Acceptance requires a confirmed session,
  // so the mailbox proof comes from Supabase's confirmation, not from possessing
  // the invitation token alone. No rollback deletes the identity: a profile may
  // already exist and ON DELETE RESTRICT would block it; a retry is safe instead.
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password: input.password,
    email_confirm: false,
    user_metadata: { name: input.name.trim() || invitation.name },
  })
  if (authError) {
    if (/already|exists|registered/i.test(authError.message)) {
      throw new InvitationError('WF04_ACCOUNT_EXISTS', 409, 'Conta existente.')
    }
    throw authError
  }
  if (!created.user) throw new Error('User creation did not return an identity')
  return { email: invitation.email, confirmationRequired: true as const }
}
