import { createClient } from '@supabase/supabase-js'
import { serverSupabaseFetch } from './server-fetch'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(url, key, {
    global: { fetch: serverSupabaseFetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
