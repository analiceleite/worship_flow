import { createClient } from '@/lib/supabase/server'

// Identity-only operations must not require a selected/active church.
export async function getAuthenticatedIdentity() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return error ? null : user
}
