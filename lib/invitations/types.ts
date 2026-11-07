import type { Minister } from '@/lib/types'

export type InvitationRole = Minister['role']
export type InvitationState = 'pending' | 'expired' | 'accepted' | 'revoked'
export type InvitationDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'

export type InvitationSummary = {
  id: string
  email: string
  name: string
  role: InvitationRole
  instrument: string
  state: InvitationState
  expires_at: string
  created_at: string
  accepted_at: string | null
  revoked_at: string | null
  delivery: {
    status: InvitationDeliveryStatus
    attempts: number
    last_error: string | null
    sent_at: string | null
  } | null
}

export type InvitationSessionState = 'anonymous' | 'matching' | 'mismatched'

export type InvitationInspection = {
  church_id: string
  church_name: string
  email_hint: string
  name: string
  role: InvitationRole
  instrument: string
  state: InvitationState
  expires_at: string
  session_state: InvitationSessionState
}

export type InvitationAcceptance = {
  status: 'active' | 'suspended' | 'pending'
  church_id: string
  church_name?: string
  minister_id: string
  role: InvitationRole
  idempotent: boolean
}

export type InvitationDeliveryResult = {
  status: InvitationDeliveryStatus
  attempts: number
  error?: string
}
