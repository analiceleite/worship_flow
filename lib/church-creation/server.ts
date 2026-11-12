import { createAdminClient } from '@/lib/supabase/admin'

// WF-38 backend: thin wrapper over public.wf38_create_church_for_identity (scripts/045).
// The database enforces the rules (verified e-mail, one church per identity, idempotency).
// Callers must pass the identity from the verified session, never from the request body.

export type ChurchCreationResult =
  | { status: 'created'; churchId: string; slug: string; membershipId: string }
  | { status: 'existing'; churchId: string }

export class ChurchCreationError extends Error {
  constructor(
    readonly code:
      | 'EMAIL_NOT_VERIFIED'
      | 'QUOTA_EXCEEDED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_INPUT'
      | 'UNKNOWN',
    message: string,
  ) {
    super(message)
    this.name = 'ChurchCreationError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ERROR_CODES: Array<[string, ChurchCreationError['code']]> = [
  ['WF38_EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED'],
  ['WF38_QUOTA_EXCEEDED', 'QUOTA_EXCEEDED'],
  ['WF38_IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
  ['WF38_INVALID_', 'INVALID_INPUT'],
]

// Read-only view of the same quota the database enforces, so the UI can explain it before submit.
export async function getChurchCreationStatus(creatorUserId: string): Promise<{
  canCreate: boolean
  limit: number
  churches: Array<{ id: string; name: string }>
}> {
  if (!UUID_PATTERN.test(creatorUserId)) {
    throw new ChurchCreationError('INVALID_INPUT', 'Solicitação inválida.')
  }
  const admin = createAdminClient()
  const [intents, allowance] = await Promise.all([
    admin.from('church_creation_intents').select('church_id, church_name').eq('creator_user_id', creatorUserId),
    admin.from('church_creation_allowances').select('extra_churches').eq('user_id', creatorUserId).maybeSingle(),
  ])
  if (intents.error || allowance.error) {
    throw new ChurchCreationError('UNKNOWN', 'Não foi possível consultar a criação de igreja agora.')
  }
  const churches = ((intents.data ?? []) as Array<{ church_id: string; church_name: string }>)
    .map(row => ({ id: row.church_id, name: row.church_name }))
  const limit = 1 + Number(allowance.data?.extra_churches ?? 0)
  return { canCreate: churches.length < limit, limit, churches }
}

export async function createChurchForVerifiedIdentity(input: {
  creatorUserId: string
  idempotencyKey: string
  churchName: string
  adminName: string
}): Promise<ChurchCreationResult> {
  const churchName = input.churchName.trim()
  const adminName = input.adminName.trim()
  if (!UUID_PATTERN.test(input.creatorUserId) || !UUID_PATTERN.test(input.idempotencyKey)) {
    throw new ChurchCreationError('INVALID_INPUT', 'Solicitação inválida.')
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('wf38_create_church_for_identity', {
    p_creator: input.creatorUserId,
    p_idempotency_key: input.idempotencyKey,
    p_church_name: churchName,
    p_admin_name: adminName,
  })

  if (error) {
    const match = ERROR_CODES.find(([marker]) => error.message?.includes(marker))
    throw new ChurchCreationError(match?.[1] ?? 'UNKNOWN', 'Não foi possível criar a igreja agora.')
  }

  const row = data as {
    status: 'created' | 'existing'
    church_id: string
    slug?: string
    membership_id?: string
  }
  if (row.status === 'existing') return { status: 'existing', churchId: row.church_id }
  return {
    status: 'created',
    churchId: row.church_id,
    slug: row.slug ?? '',
    membershipId: row.membership_id ?? '',
  }
}
