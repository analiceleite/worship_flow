import { google, Auth } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'

type OAuth2Client = Auth.OAuth2Client
type Credentials = Auth.Credentials

type CredentialRow = {
  access_token: string
  refresh_token: string
  expiry_date: number | null
  scope: string | null
}

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

/** Personal credential: the same connected Google account serves every church the
 *  person belongs to. It is never stored per membership. */
export async function saveTokensForUser(userId: string, tokens: Credentials) {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google authorization did not return the required tokens.')
  }

  const admin = createAdminClient()
  const { error } = await admin.from('google_calendar_credentials').upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(error.message)
}

export async function hasCredentialForUser(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('google_calendar_credentials')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function enableChurchSync(userId: string, churchId: string, ministerId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('google_calendar_church_sync').upsert(
    {
      user_id: userId,
      church_id: churchId,
      minister_id: ministerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,church_id' }
  )
  if (error) throw new Error(error.message)
}

export async function disableChurchSync(userId: string, churchId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('google_calendar_church_sync')
    .delete()
    .eq('user_id', userId)
    .eq('church_id', churchId)
  if (error) throw new Error(error.message)
}

export async function isChurchSyncEnabled(userId: string, churchId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('google_calendar_church_sync')
    .select('church_id')
    .eq('user_id', userId)
    .eq('church_id', churchId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function listChurchSyncSelections(userId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('google_calendar_church_sync')
    .select('church_id, minister_id')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ church_id: string; minister_id: string }>
}

export async function getUserIdForMinister(ministerId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('ministers')
    .select('user_id')
    .eq('id', ministerId)
    .maybeSingle()
  return data?.user_id ?? null
}

async function credentialRowForUser(userId: string): Promise<CredentialRow | null> {
  const admin = createAdminClient()
  const { data: current } = await admin
    .from('google_calendar_credentials')
    .select('access_token, refresh_token, expiry_date, scope')
    .eq('user_id', userId)
    .maybeSingle()
  if (current) return current as CredentialRow

  // Transitional fallback for a stack where the expansion is deployed before the
  // backfill observer runs. Promoting the row here keeps one credential per person
  // without revoking or deleting the legacy token.
  const { data: memberships } = await admin
    .from('ministers')
    .select('id, church_id')
    .eq('user_id', userId)
  const ministerIds = ((memberships ?? []) as Array<{ id: string; church_id: string }>).map((row) => row.id)
  if (ministerIds.length === 0) return null

  const { data: legacyRows } = await admin
    .from('google_calendar_tokens')
    .select('minister_id, church_id, access_token, refresh_token, expiry_date, scope, connected_at, updated_at')
    .in('minister_id', ministerIds)
    .order('updated_at', { ascending: false })
    .limit(1)
  const legacy = legacyRows?.[0]
  if (!legacy?.refresh_token) return null

  const { error } = await admin.from('google_calendar_credentials').upsert(
    {
      user_id: userId,
      access_token: legacy.access_token,
      refresh_token: legacy.refresh_token,
      expiry_date: legacy.expiry_date,
      scope: legacy.scope,
      connected_at: legacy.connected_at,
      updated_at: legacy.updated_at,
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    console.error('Failed to promote legacy Google credential:', error.message)
  } else {
    const membership = ((memberships ?? []) as Array<{ id: string; church_id: string }>).find((row) => row.id === legacy.minister_id)
    const churchId = legacy.church_id ?? membership?.church_id
    if (churchId) {
      await admin.from('google_calendar_church_sync').upsert(
        { user_id: userId, church_id: churchId, minister_id: legacy.minister_id },
        { onConflict: 'user_id,church_id' }
      )
    }
  }

  return legacy as CredentialRow
}

/** Returns null if the person has no connected Google account. Auto-persists refreshed
 *  access tokens transparently via the `tokens` event (fires whenever googleapis refreshes). */
export async function getAuthorizedClientForUser(userId: string): Promise<OAuth2Client | null> {
  const row = await credentialRowForUser(userId)
  if (!row) return null

  const client = createBareOAuth2Client()
  client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date ?? undefined,
    scope: row.scope ?? undefined,
  })

  const admin = createAdminClient()
  client.on('tokens', (newTokens) => {
    // Fire-and-forget persistence, but never throw out of the event handler.
    admin
      .from('google_calendar_credentials')
      .update({
        access_token: newTokens.access_token ?? row.access_token,
        expiry_date: newTokens.expiry_date ?? row.expiry_date,
        ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('Failed to persist refreshed Google token:', error.message)
      })
  })

  return client
}

export async function getAuthorizedClientForMinister(ministerId: string): Promise<OAuth2Client | null> {
  const userId = await getUserIdForMinister(ministerId)
  if (!userId) return null
  return getAuthorizedClientForUser(userId)
}

export async function deleteEventMappingsForMinister(ministerId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('google_calendar_event_map')
    .delete()
    .eq('minister_id', ministerId)
  if (error) throw new Error(error.message)
}

export async function deleteCredentialsForUser(userId: string) {
  const admin = createAdminClient()
  const { error: credentialError } = await admin
    .from('google_calendar_credentials')
    .delete()
    .eq('user_id', userId)
  if (credentialError) throw new Error(credentialError.message)

  const { error: selectionError } = await admin
    .from('google_calendar_church_sync')
    .delete()
    .eq('user_id', userId)
  if (selectionError) throw new Error(selectionError.message)
}

/** Marks a personal connection as broken (invalid_grant / revoked by the user in their
 *  Google Account settings) instead of retrying forever on every cron cycle. */
export async function markConnectionBroken(ministerId: string) {
  const admin = createAdminClient()
  const userId = await getUserIdForMinister(ministerId)

  if (!userId) {
    await admin.from('google_calendar_event_map').delete().eq('minister_id', ministerId)
    return
  }

  const { data: memberships } = await admin
    .from('ministers')
    .select('id')
    .eq('user_id', userId)
  const ministerIds = ((memberships ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (ministerIds.length > 0) {
    await admin.from('google_calendar_event_map').delete().in('minister_id', ministerIds)
  }
  await admin.from('google_calendar_church_sync').delete().eq('user_id', userId)
  await admin.from('google_calendar_credentials').delete().eq('user_id', userId)
}
