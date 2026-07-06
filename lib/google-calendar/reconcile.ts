import { createHash } from 'crypto'
import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getAuthorizedClientForMinister,
  markConnectionBroken,
  deleteTokensAndMappings,
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

function contentHashFor(item: CalendarEventItem, alarmOffsets: number[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        summary: item.eventLabel,
        description: item.description,
        start: item.arrivalUtc.toISOString(),
        end: item.endUtc.toISOString(),
        alarmOffsets,
      })
    )
    .digest('hex')
}

function toEventBody(item: CalendarEventItem, alarmOffsets: number[]) {
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

export type ReconcileResult =
  | { skipped: 'not_connected' }
  | { inserted: number; updated: number; deleted: number }

type EventMapRow = { event_key: string; google_event_id: string; content_hash: string }

export async function reconcileMinisterCalendar(ministerId: string): Promise<ReconcileResult> {
  const admin = createAdminClient()
  const oauthClient = await getAuthorizedClientForMinister(ministerId)
  if (!oauthClient) return { skipped: 'not_connected' }

  const calendar = google.calendar({ version: 'v3', auth: oauthClient })

  const [built, ministerRes, mappingRes] = await Promise.all([
    buildMinisterCalendarEvents(ministerId),
    admin.from('ministers').select('calendar_alarm_offsets_minutes').eq('id', ministerId).single(),
    admin
      .from('google_calendar_event_map')
      .select('event_key, google_event_id, content_hash')
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
    for (const item of built.events) {
      const hash = contentHashFor(item, alarmOffsets)
      const prior = existing.get(item.eventKey)
      const body = toEventBody(item, alarmOffsets)

      if (!prior) {
        const res = await withRetry(() =>
          calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body })
        )
        await admin.from('google_calendar_event_map').upsert(
          {
            minister_id: ministerId,
            event_key: item.eventKey,
            google_event_id: res.data.id!,
            content_hash: hash,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'minister_id,event_key' }
        )
        inserted++
      } else if (prior.content_hash !== hash) {
        await withRetry(() =>
          calendar.events.update({
            calendarId: CALENDAR_ID,
            eventId: prior.google_event_id,
            requestBody: body,
          })
        )
        await admin
          .from('google_calendar_event_map')
          .update({ content_hash: hash, updated_at: new Date().toISOString() })
          .eq('minister_id', ministerId)
          .eq('event_key', item.eventKey)
        updated++
      }
    }

    for (const [eventKey, row] of existing.entries()) {
      if (desiredKeys.has(eventKey)) continue
      try {
        await withRetry(() =>
          calendar.events.delete({ calendarId: CALENDAR_ID, eventId: row.google_event_id })
        )
      } catch (err) {
        const status = statusOf(err)
        if (status !== 404 && status !== 410) throw err // already gone on Google's side = fine
      }
      await admin
        .from('google_calendar_event_map')
        .delete()
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
export async function reconcileMinistersForQuarter(quarterId: string) {
  const admin = createAdminClient()
  const { data: assignedMinisters } = await admin
    .from('schedule_assignments')
    .select('minister_id')
    .eq('quarter_id', quarterId)
    .not('minister_id', 'is', null)

  const ministerIds = [
    ...new Set(((assignedMinisters ?? []) as Array<{ minister_id: string }>).map((r) => r.minister_id)),
  ]
  if (ministerIds.length === 0) return { ministers: 0, errors: [] as Array<{ ministerId: string; error: string }> }

  const { data: connected } = await admin
    .from('google_calendar_tokens')
    .select('minister_id')
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

/** Full safety-net sync for the periodic cron — every connected minister, regardless of quarter. */
export async function reconcileAllConnectedMinisters() {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('google_calendar_tokens').select('minister_id')
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

export async function disconnectMinister(ministerId: string) {
  const oauthClient = await getAuthorizedClientForMinister(ministerId)
  if (oauthClient) {
    const admin = createAdminClient()
    const { data: mappings } = await admin
      .from('google_calendar_event_map')
      .select('google_event_id')
      .eq('minister_id', ministerId)
    const calendar = google.calendar({ version: 'v3', auth: oauthClient })
    for (const m of (mappings ?? []) as Array<{ google_event_id: string }>) {
      try {
        await withRetry(() =>
          calendar.events.delete({ calendarId: CALENDAR_ID, eventId: m.google_event_id })
        )
      } catch (err) {
        const status = statusOf(err)
        if (status !== 404 && status !== 410) console.error('Failed to delete event on disconnect:', err)
      }
    }
    try {
      await oauthClient.revokeCredentials()
    } catch (err) {
      console.error('Failed to revoke Google token:', err)
    }
  }
  await deleteTokensAndMappings(ministerId)
}
