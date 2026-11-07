import type { InvitationSessionState } from './types'

// Pure comparison used by the inspection endpoint. The invitation e-mail never
// leaves the server; only the resulting state is returned to the page.
export function sessionStateFor(
  sessionEmail: string | null | undefined,
  invitationEmail: string | null | undefined,
): InvitationSessionState {
  if (!sessionEmail) return 'anonymous'
  if (!invitationEmail) return 'mismatched'
  return sessionEmail.trim().toLowerCase() === invitationEmail.trim().toLowerCase() ? 'matching' : 'mismatched'
}
