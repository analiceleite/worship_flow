import { createAdminClient } from '@/lib/supabase/admin'
import {
  getArrivalTime,
  getServiceTime,
  buildLocalDateTimeUtc,
  type EventType,
  type QuarterTimeConfig,
} from '@/lib/schedule/event-time'

export type CalendarEventItem = {
  eventKey: string // `${event_date}_${event_type}`
  eventDate: string
  eventType: EventType
  roleNames: string[]
  eventLabel: string
  description: string // raw text, real newlines — caller escapes per target format (ICS, Google API, etc.)
  arrivalUtc: Date
  endUtc: Date
}

type AssignmentRow = {
  quarter_id: string
  minister_id: string | null
  event_date: string
  event_type: EventType
  role: { name: string } | null
}

type RehearsalRow = {
  event_date: string
  event_type: EventType
  rehearsal_time: string | null
}

type QuarterRow = QuarterTimeConfig & { id: string; start_date: string }

export function normalizeAlarmOffsetsMinutes(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [720, 60]
  return arr
    .map((v: unknown) => (typeof v === 'string' ? parseInt(v, 10) : v))
    .filter((v): v is number => typeof v === 'number' && !isNaN(v) && v > 0)
    .sort((a, b) => b - a)
}

/** Builds the consolidated (one event per day, multiple roles merged) calendar event list for a
 *  minister. Shared by the ICS feed and the Google Calendar sync so both stay in lockstep. */
export async function buildMinisterCalendarEvents(
  ministerId: string,
  expectedChurchId: string
): Promise<{ ministerName: string; events: CalendarEventItem[] } | null> {
  const admin = createAdminClient()

  // Service role bypasses RLS: the church filter is what keeps this lookup inside the caller's church.
  const ministerRes = await admin
    .from('ministers')
    .select('id, church_id, name')
    .eq('id', ministerId)
    .eq('church_id', expectedChurchId)
    .single()

  if (ministerRes.error || !ministerRes.data) return null

  const ministerName = ministerRes.data.name as string
  const churchId = ministerRes.data.church_id as string

  const [assignmentsRes, rehearsalsRes, quartersRes, churchRes, controlsRes] = await Promise.all([
    admin
      .from('schedule_assignments')
      .select('quarter_id, minister_id, event_date, event_type, role:schedule_roles(name)')
      .eq('church_id', churchId)
      .eq('minister_id', ministerId)
      .order('event_date', { ascending: true }),
    admin
      .from('schedule_rehearsals')
      .select('event_date, event_type, rehearsal_time')
      .eq('church_id', churchId),
    admin
      .from('schedule_quarters')
      .select('*')
      .eq('church_id', churchId)
      .eq('is_published', true),
    admin
      .from('churches')
      .select('timezone')
      .eq('id', churchId)
      .maybeSingle(),
    admin
      .from('schedule_event_controls')
      .select('quarter_id, event_date, event_type')
      .eq('church_id', churchId)
      .eq('status', 'cancelled'),
  ])

  if (assignmentsRes.error || rehearsalsRes.error || quartersRes.error || churchRes.error || controlsRes.error) {
    throw new Error('Database error building calendar events')
  }

  const assignments = (assignmentsRes.data || []) as AssignmentRow[]
  const rehearsals = ((rehearsalsRes.data || []) as RehearsalRow[])
  const quarters = ((quartersRes.data || []) as QuarterRow[])
  const timeZone = churchRes.data?.timezone || 'America/Sao_Paulo'
  const quarterById = new Map(quarters.map(quarter => [quarter.id, quarter]))
  const cancelledKeys = new Set((controlsRes.data ?? []).map((item: { quarter_id: string; event_date: string; event_type: string }) =>
    `${item.quarter_id}_${item.event_date}_${item.event_type}`
  ))

  const rehearsalsByEvent = new Map<string, RehearsalRow>()
  for (const r of rehearsals) {
    rehearsalsByEvent.set(`${r.event_date}_${r.event_type}`, r)
  }

  if (!quarters.length) return { ministerName, events: [] }

  // Group assignments by event_date and event_type to handle multiple roles per day.
  const eventMap = new Map<string, AssignmentRow[]>()
  for (const assignment of assignments) {
    if (cancelledKeys.has(`${assignment.quarter_id}_${assignment.event_date}_${assignment.event_type}`)) continue
    const key = `${assignment.event_date}_${assignment.event_type}`
    if (!eventMap.has(key)) eventMap.set(key, [])
    eventMap.get(key)!.push(assignment)
  }

  const events: CalendarEventItem[] = []

  for (const [eventKey, eventAssignments] of eventMap.entries()) {
    const firstAssignment = eventAssignments[0]
    const quarter = quarterById.get(firstAssignment.quarter_id)
    if (!quarter) continue

    const rehearsal = rehearsalsByEvent.get(eventKey)
    const arrivalTimeStr = rehearsal?.rehearsal_time || getArrivalTime(firstAssignment.event_type, quarter)
    const serviceTimeStr = getServiceTime(firstAssignment.event_type, quarter)
    const serviceUtc = buildLocalDateTimeUtc(firstAssignment.event_date, serviceTimeStr, timeZone)

    const roleNames = eventAssignments
      .map((a) => a.role?.name ?? 'Função')
      .filter((role, index, self) => self.indexOf(role) === index) // remove duplicates

    const roleList = roleNames.join(', ')
    const eventLabel = firstAssignment.event_type === 'thursday'
      ? `Escala — Quinta: ${roleList} (ensaio ${arrivalTimeStr} / culto ${serviceTimeStr})`
      : `Escala — Domingo: ${roleList} (chegada ${arrivalTimeStr} / culto ${serviceTimeStr})`

    const eventTypeLabel = firstAssignment.event_type === 'thursday' ? 'Ensaio e Culto' : 'Culto'
    const description = `Ministro: ${ministerName}\nFunções: ${roleList}\nTipo: ${eventTypeLabel}`

    events.push({
      eventKey,
      eventDate: firstAssignment.event_date,
      eventType: firstAssignment.event_type,
      roleNames,
      eventLabel,
      description,
      arrivalUtc: buildLocalDateTimeUtc(firstAssignment.event_date, arrivalTimeStr, timeZone),
      endUtc: new Date(serviceUtc.getTime() + 90 * 60_000),
    })
  }

  return { ministerName, events }
}
