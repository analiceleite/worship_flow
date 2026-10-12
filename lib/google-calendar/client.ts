import { google, Auth } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'

type OAuth2Client = Auth.OAuth2Client
type Credentials = Auth.Credentials

const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

function redirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/api/google-calendar/callback`
}

export function createBareOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  )
}

export function getAuthUrl(state: string): string {
  return createBareOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // guarantees a refresh_token even on repeat consent
    scope: SCOPES,
    state,
  })
}

export async function exchangeCodeForTokens(code: string): Promise<Credentials> {
  const client = createBareOAuth2Client()
  const { tokens } = await client.getToken(code)
  return tokens
}

export async function saveTokensForMinister(ministerId: string, churchId: string, tokens: Credentials) {
  const admin = createAdminClient()
  const { error } = await admin.from('google_calendar_tokens').upsert(
    {
      church_id: churchId,
      minister_id: ministerId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'minister_id' }
  )
  if (error) throw new Error(error.message)
}

/** Returns null if the minister has no connected Google account. Auto-persists refreshed
 *  access tokens transparently via the `tokens` event (fires whenever googleapis refreshes). */
export async function getAuthorizedClientForMinister(ministerId: string): Promise<OAuth2Client | null> {
  const admin = createAdminClient()
  const { data: minister } = await admin
    .from('ministers')
    .select('church_id')
    .eq('id', ministerId)
    .maybeSingle()

  if (!minister?.church_id) return null

  const { data: row } = await admin
    .from('google_calendar_tokens')
    .select('access_token, refresh_token, expiry_date, scope')
    .eq('church_id', minister.church_id)
    .eq('minister_id', ministerId)
    .maybeSingle()

  if (!row) return null

  const client = createBareOAuth2Client()
  client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date ?? undefined,
    scope: row.scope ?? undefined,
  })

  client.on('tokens', (newTokens) => {
    // Fire-and-forget persistence, but never throw out of the event handler.
    admin
      .from('google_calendar_tokens')
      .update({
        access_token: newTokens.access_token ?? row.access_token,
        expiry_date: newTokens.expiry_date ?? row.expiry_date,
        ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('church_id', minister.church_id)
      .eq('minister_id', ministerId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('Failed to persist refreshed Google token:', error.message)
      })
  })

  return client
}

export async function deleteTokensAndMappings(ministerId: string) {
  const admin = createAdminClient()
  const { data: minister } = await admin
    .from('ministers')
    .select('church_id')
    .eq('id', ministerId)
    .maybeSingle()

  let mappingsQuery = admin.from('google_calendar_event_map').delete().eq('minister_id', ministerId)
  let tokensQuery = admin.from('google_calendar_tokens').delete().eq('minister_id', ministerId)

  if (minister?.church_id) {
    mappingsQuery = mappingsQuery.eq('church_id', minister.church_id)
    tokensQuery = tokensQuery.eq('church_id', minister.church_id)
  }

  await mappingsQuery
  await tokensQuery
}

/** Marks a connection as broken (invalid_grant / revoked by the user in their Google Account
 *  settings) instead of retrying forever on every cron cycle. */
export async function markConnectionBroken(ministerId: string) {
  await deleteTokensAndMappings(ministerId)
}
