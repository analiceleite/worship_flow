import type { MembershipState } from '@/lib/types'

export type MembershipCandidate = {
  id: string
  church_id: string
  role: 'admin' | 'minister' | 'midia'
  access_state: MembershipState
  church_status: 'active' | 'inactive'
}

export type MembershipResolution =
  | { kind: 'selected'; membership: MembershipCandidate }
  | { kind: 'selection_required' }
  | { kind: 'unavailable' }

// Selection is a preference, never authorization. Never fall back from an
// explicitly requested, inaccessible church to a different tenant.
export function resolveMembership(
  memberships: readonly MembershipCandidate[],
  requestedChurchId?: string | null,
): MembershipResolution {
  const accessible = memberships.filter(
    membership => membership.access_state === 'active' && membership.church_status === 'active',
  )

  if (requestedChurchId) {
    const membership = accessible.find(item => item.church_id === requestedChurchId)
    return membership ? { kind: 'selected', membership } : { kind: 'unavailable' }
  }

  if (accessible.length === 1) return { kind: 'selected', membership: accessible[0] }
  return { kind: accessible.length > 1 ? 'selection_required' : 'unavailable' }
}
