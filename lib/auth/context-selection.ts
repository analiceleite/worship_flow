export const CHURCH_CONTEXT_COOKIE = 'wf_selected_church'
export const CHURCH_CONTEXT_HEADER = 'x-wf-church-id'

export function isChurchId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

// This is an unsigned preference, scoped to the current identity. Membership
// and church state must still be checked for every operational request.
export function readChurchPreference(value: string | undefined, userId: string): string | null {
  if (!value || value.length > 500) return null
  try {
    const preference = JSON.parse(value)
    return preference?.userId === userId && typeof preference.churchId === 'string' && isChurchId(preference.churchId)
      ? preference.churchId.toLowerCase() : null
  } catch {
    return null
  }
}

export function churchPreferenceValue(userId: string, churchId: string): string {
  return JSON.stringify({ userId, churchId: churchId.toLowerCase() })
}
