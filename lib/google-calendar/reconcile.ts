import { createHash } from 'crypto'
import { google, calendar_v3 } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getAuthorizedClientForMinister,
  getAuthorizedClientForUser,
  markConnectionBroken,
  deleteEventMappingsForMinister,
  deleteCredentialsForUser,
  disableChurchSync,
} from '@/lib/google-calendar/client'
import {
  buildMinisterCalendarEvents,
  normalizeAlarmOffsetsMinutes,
  type CalendarEventItem,
} from '@/lib/schedule/calendar-events'

const TIME_ZONE = 'America/Sao_Paulo'
// Locked-in design decision: `calendar.events` scope only permits event operations, not
// creating/deleting a dedicated secondary calendar (that would need the broader `calendar` scope).
const CALENDAR_ID = 'primary'
const PRIVATE_MINISTER_ID = 'worshipFlowMinisterId'
const PRIVATE_EVENT_KEY = 'worshipFlowEventKey'
const EVENT_MARKER_VERSION = 2

function contentHashFor(item: CalendarEventItem, alarmOffsets: number[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        summary: item.eventLabel,
        description: item.description,
        start: item.arrivalUtc.toISOString(),
        end: item.endUtc.toISOString(),
        alarmOffsets,
        markerVersion: EVENT_MARKER_VERSION,
      })
    )
    .digest('hex')
}

function toEventBody(item: CalendarEventItem, alarmOffsets: number[], ministerId: string) {
  return {
    summary: item.eventLabel,
    description: item.description,
    start: { dateTime: item.arrivalUtc.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: item.endUtc.toISOString(), timeZone: TIME_ZONE },
    reminders: {
      useDefault: false,
      // Google caps overrides at 5 entries / 40320 min each. Today's UI (4 checkboxes) can't
      // exceed this, but clamp defensively since the list ultimately comes from a user-editable
      // DB column.
      overrides: alarmOffsets
        .slice(0, 5)
        .filter((m) => m > 0 && m <= 40320)
        .map((minutes) => ({ method: 'popup' as const, minutes })),
    },
    extendedProperties: {
      private: {
        [PRIVATE_MINISTER_ID]: ministerId,
        [PRIVATE_EVENT_KEY]: item.eventKey,
      },
    },
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const anyErr = err as { code?: number; response?: { status?: number; headers?: Record<string, string> } }
      const status = anyErr?.code ?? anyErr?.response?.status
      const isRateLimit = status === 429 || status === 403
      if (!isRateLimit || attempt === maxAttempts) throw err
      const retryAfter = Number(anyErr?.response?.headers?.['retry-after'])
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 1000)
    }
  }
  throw new Error('unreachable')
}

function statusOf(err: unknown): number | undefined {
  const anyErr = err as { code?: number; response?: { status?: number } }
  return anyErr?.code ?? anyErr?.response?.status
}

function isNotFound(err: unknown) {
  const status = statusOf(err)
  return status === 404 || status === 410
}

function eventTimeMs(value: string | null | undefined) {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function isLegacyMatch(event: calendar_v3.Schema$Event, item: CalendarEventItem) {
  const startMs = eventTimeMs(event.start?.dateTime)
  const endMs = eventTimeMs(event.end?.dateTime)

  return event.status !== 'cancelled' &&
    event.summary === item.eventLabel &&
    event.description === item.description &&
    startMs === item.arrivalUtc.getTime() &&
    endMs === item.endUtc.getTime()
}

async function findExistingGoogleEvents(
  calendar: calendar_v3.Calendar,
  ministerId: string,
  item: CalendarEventItem
) {
  const marked = await withRetry(() =>
    calendar.events.list({
      calendarId: CALENDAR_ID,
      privateExtendedProperty: [
        `${PRIVATE_MINISTER_ID}=${ministerId}`,
        `${PRIVATE_EVENT_KEY}=${item.eventKey}`,
      ],
      showDeleted: false,
      singleEvents: true,
    })
  )
  const markedEvents = (marked.data.items ?? []).filter((event) => event.id)
  if (markedEvents.length) return markedEvents

  const windowStart = new Date(item.arrivalUtc.getTime() - 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(item.endUtc.getTime() + 60 * 60 * 1000).toISOString()
  const legacy = await withRetry(() =>
    calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: windowStart,
      timeMax: windowEnd,
      q: 'Escala',
      showDeleted: false,
      singleEvents: true,
    })
  )

  return (legacy.data.items ?? []).filter((event) => event.id && isLegacyMatch(event, item))
}

async function deleteGoogleEvent(calendar: calendar_v3.Calendar, eventId: string) {
  try {
    await withRetry(() => calendar.events.delete({ calendarId: CALENDAR_ID, eventId }))
    return true
  } catch (err) {
    if (!isNotFound(err)) throw err
    return false
  }
}

export type ReconcileResult =
  | { skipped: 'not_connected' }
  | { skipped: 'not_enabled' }
  | { inserted: number; updated: number; deleted: number }

type EventMapRow = { event_key: string; google_event_id: string; content_hash: string }

export async function reconcileMinisterCalendar(ministerId: string): Promise<ReconcileResult> {
  const admin = createAdminClient()
  const { data: minister } = await admin
    .from('ministers')
    .select('church_id, user_id')
    .eq('id', ministerId)
    .maybeSingle()

  if (!minister?.church_id || !minister.user_id) return { skipped: 'not_connected' }

  const { data: selection } = await admin
    .from('google_calendar_church_sync')
    .select('church_id')
    .eq('user_id', minister.user_id)
    .eq('church_id', minister.church_id)
    .maybeSingle()

  if (!selection) return { skipped: 'not_enabled' }

  const oauthClient = await getAuthorizedClientForMinister(ministerId)
  if (!oauthClient) return { skipped: 'not_connected' }
  const churchId = minister.church_id
  const userId = minister.user_id

  const calendar = google.calendar({ version: 'v3', auth: oauthClient })

  const [built, ministerRes, mappingRes] = await Promise.all([
    buildMinisterCalendarEvents(ministerId, churchId),
    admin
      .from('ministers')
      .select('calendar_alarm_offsets_minutes')
      .eq('id', ministerId)
      .eq('church_id', churchId)
      .single(),
    admin
      .from('google_calendar_event_map')
      .select('event_key, google_event_id, content_hash')
      .eq('church_id', churchId)
      .eq('minister_id', ministerId),
  ])
  if (!built) return { skipped: 'not_connected' }

  const alarmOffsets = normalizeAlarmOffsetsMinutes(ministerRes.data?.calendar_alarm_offsets_minutes)
  const mappingRows = (mappingRes.data ?? []) as EventMapRow[]
  const existing = new Map(mappingRows.map((r) => [r.event_key, r]))
  const desiredKeys = new Set(built.events.map((e: CalendarEventItem) => e.eventKey))

  let inserted = 0
  let updated = 0
  let deleted = 0

  try {
    const marked = await withRetry(() =>
      calendar.events.list({
        calendarId: CALENDAR_ID,
        privateExtendedProperty: [`${PRIVATE_MINISTER_ID}=${ministerId}`],
        showDeleted: false,
        singleEvents: true,
      })
    )

    for (const event of marked.data.items ?? []) {
      const eventKey = event.extendedProperties?.private?.[PRIVATE_EVENT_KEY]
      if (!event.id || !eventKey || desiredKeys.has(eventKey)) continue

      if (await deleteGoogleEvent(calendar, event.id)) deleted++
      await admin
        .from('google_calendar_event_map')
        .delete()
        .eq('church_id', churchId)
        .eq('minister_id', ministerId)
        .eq('event_key', eventKey)
    }

    for (const item of built.events) {
      const hash = contentHashFor(item, alarmOffsets)
      const prior = existing.get(item.eventKey)
      const body = toEventBody(item, alarmOffsets, ministerId)

      if (!prior) {
        const matches = await findExistingGoogleEvents(calendar, ministerId, item)
        const primaryMatch = matches[0]
        const googleEventId = primaryMatch?.id

        if (googleEventId) {
          await withRetry(() =>
            calendar.events.update({ calendarId: CALENDAR_ID, eventId: googleEventId, requestBody: body })
          )
          updated++
        }

        const res = googleEventId
          ? { data: { id: googleEventId } }
          : await withRetry(() => calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body }))

        await admin.from('google_calendar_event_map').upsert(
          {
            church_id: churchId,
            minister_id: ministerId,
            user_id: userId,
            event_key: item.eventKey,
            google_event_id: res.data.id!,
            content_hash: hash,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'minister_id,event_key' }
        )

        for (const duplicate of matches.slice(1)) {
          if (duplicate.id && await deleteGoogleEvent(calendar, duplicate.id)) deleted++
        }

        if (!googleEventId) inserted++
      } else if (prior.content_hash !== hash) {
        try {
          await withRetry(() =>
            calendar.events.update({
              calendarId: CALENDAR_ID,
              eventId: prior.google_event_id,
              requestBody: body,
            })
          )
        } catch (err) {
          if (!isNotFound(err)) throw err

          const matches = await findExistingGoogleEvents(calendar, ministerId, item)
          const googleEventId = matches[0]?.id
          if (googleEventId) {
            await withRetry(() =>
              calendar.events.update({ calendarId: CALENDAR_ID, eventId: googleEventId, requestBody: body })
            )
            await admin
              .from('google_calendar_event_map')
              .update({ google_event_id: googleEventId })
              .eq('church_id', churchId)
              .eq('minister_id', ministerId)
              .eq('event_key', item.eventKey)
          } else {
            const res = await withRetry(() => calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body }))
            await admin
              .from('google_calendar_event_map')
              .update({ google_event_id: res.data.id! })
              .eq('church_id', churchId)
              .eq('minister_id', ministerId)
              .eq('event_key', item.eventKey)
            inserted++
          }

          for (const duplicate of matches.slice(1)) {
            if (duplicate.id && await deleteGoogleEvent(calendar, duplicate.id)) deleted++
          }
        }

        await admin
          .from('google_calendar_event_map')
          .update({ content_hash: hash, updated_at: new Date().toISOString() })
          .eq('church_id', churchId)
          .eq('minister_id', ministerId)
          .eq('event_key', item.eventKey)
        updated++
      }
    }

    for (const [eventKey, row] of existing.entries()) {
      if (desiredKeys.has(eventKey)) continue
      await deleteGoogleEvent(calendar, row.google_event_id)
      await admin
        .from('google_calendar_event_map')
        .delete()
        .eq('church_id', churchId)
        .eq('minister_id', ministerId)
        .eq('event_key', eventKey)
      deleted++
    }
  } catch (err) {
    const status = statusOf(err)
    const reason = (err as { message?: string; response?: { data?: { error?: string } } })?.response?.data?.error
      ?? (err as { message?: string })?.message
    if (status === 401 || /invalid_grant/i.test(String(reason))) {
      await markConnectionBroken(ministerId)
    }
    throw err
  }

  return { inserted, updated, deleted }
}

/** Scoped sync for the publish/unpublish hook — only ministers actually assigned in this quarter. */
export async function reconcileMinistersForQuarter(quarterId: string, churchId: string) {
  const admin = createAdminClient()
  const { data: quarter } = await admin
    .from('schedule_quarters')
    .select('church_id')
    .eq('id', quarterId)
    .eq('church_id', churchId)
    .maybeSingle()

  if (!quarter?.church_id) return { ministers: 0, errors: [] as Array<{ ministerId: string; error: string }> }

  const { data: assignedMinisters } = await admin
    .from('schedule_assignments')
    .select('minister_id')
    .eq('church_id', quarter.church_id)
    .eq('quarter_id', quarterId)
    .not('minister_id', 'is', null)

  const ministerIds = [
    ...new Set(((assignedMinisters ?? []) as Array<{ minister_id: string }>).map((r) => r.minister_id)),
  ]
  if (ministerIds.length === 0) return { ministers: 0, errors: [] as Array<{ ministerId: string; error: string }> }

  const { data: connected } = await admin
    .from('google_calendar_church_sync')
    .select('minister_id')
    .eq('church_id', quarter.church_id)
    .in('minister_id', ministerIds)

  const errors: Array<{ ministerId: string; error: string }> = []
  for (const row of (connected ?? []) as Array<{ minister_id: string }>) {
    try {
      await reconcileMinisterCalendar(row.minister_id)
    } catch (err) {
      errors.push({ ministerId: row.minister_id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ministers: (connected ?? []).length, errors }
}

/** Full safety-net sync for the periodic cron — every church explicitly opted in. */
export async function reconcileAllConnectedMinisters() {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('google_calendar_church_sync').select('minister_id')
  const errors: Array<{ ministerId: string; error: string }> = []
  for (const row of (rows ?? []) as Array<{ minister_id: string }>) {
    try {
      await reconcileMinisterCalendar(row.minister_id)
    } catch (err) {
      errors.push({ ministerId: row.minister_id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ministers: (rows ?? []).length, errors }
}

type AuthorizedClient = Awaited<ReturnType<typeof getAuthorizedClientForUser>>

/**
 * Deletes only the events marked with this membership's ID. Another church the same
 * person syncs keeps its events untouched.
 */
async function removeMinisterGoogleEvents(
  oauthClient: AuthorizedClient,
  ministerId: string,
  churchId: string
) {
  if (oauthClient) {
    const admin = createAdminClient()
    const { data: mappings } = await admin
      .from('google_calendar_event_map')
      .select('google_event_id')
      .eq('church_id', churchId)
      .eq('minister_id', ministerId)

    const calendar = google.calendar({ version: 'v3', auth: oauthClient })
    const eventIds = new Set<string>(
      (mappings ?? []).map((m: { google_event_id: string }) => m.google_event_id)
    )

    try {
      const marked = await withRetry(() =>
        calendar.events.list({
          calendarId: CALENDAR_ID,
          privateExtendedProperty: [`${PRIVATE_MINISTER_ID}=${ministerId}`],
          showDeleted: false,
          singleEvents: true,
        })
      )

      for (const event of marked.data.items ?? []) {
        if (event.id) eventIds.add(event.id)
      }
    } catch (err) {
      console.error('Failed to list marked Google events on disconnect:', err)
    }

    for (const eventId of eventIds) {
      try {
        await deleteGoogleEvent(calendar, eventId)
      } catch (err) {
        console.error('Failed to delete event on disconnect:', err)
      }
    }
  }

  await deleteEventMappingsForMinister(ministerId)
}

/** Stops syncing one church. The personal Google connection and the other churches
 *  remain connected. */
export async function disconnectChurchSync(ministerId: string) {
  const admin = createAdminClient()
  const { data: minister } = await admin
    .from('ministers')
    .select('church_id, user_id')
    .eq('id', ministerId)
    .maybeSingle()

  if (!minister?.church_id) return

  const oauthClient = await getAuthorizedClientForMinister(ministerId)
  await removeMinisterGoogleEvents(oauthClient, ministerId, minister.church_id)

  if (minister.user_id) {
    await disableChurchSync(minister.user_id, minister.church_id)
  }
}

/** Disconnects the personal Google account from every church. Used only when the person
 *  explicitly chooses to revoke the connection, not when leaving one church. */
export async function disconnectUserAccount(userId: string) {
  const admin = createAdminClient()
  const { data: memberships } = await admin
    .from('ministers')
    .select('id, church_id')
    .eq('user_id', userId)

  const oauthClient = await getAuthorizedClientForUser(userId)
  for (const membership of memberships ?? []) {
    await removeMinisterGoogleEvents(oauthClient, membership.id, membership.church_id)
  }

  if (oauthClient) {
    try {
      await oauthClient.revokeCredentials()
    } catch (err) {
      console.error('Failed to revoke Google token:', err)
    }
  }

  await deleteCredentialsForUser(userId)
}
