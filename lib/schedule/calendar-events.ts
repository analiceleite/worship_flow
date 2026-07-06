import { createAdminClient } from '@/lib/supabase/admin'
import {
  getArrivalTime,
  getServiceTime,
  addMinutesToTime,
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

type QuarterRow = QuarterTimeConfig & { id: string }

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
  ministerId: string
): Promise<{ ministerName: string; events: CalendarEventItem[] } | null> {
  const admin = createAdminClient()

  const [ministerRes, assignmentsRes, rehearsalsRes, quartersRes] = await Promise.all([
    admin.from('ministers').select('id, name').eq('id', ministerId).single(),
    admin
      .from('schedule_assignments')
      .select('minister_id, event_date, event_type, role:schedule_roles(name)')
      .eq('minister_id', ministerId)
      .order('event_date', { ascending: true }),
    admin.from('schedule_rehearsals').select('event_date, event_type, rehearsal_time'),
    admin.from('schedule_quarters').select('*'),
  ])

  if (ministerRes.error || !ministerRes.data) return null
  if (assignmentsRes.error || rehearsalsRes.error || quartersRes.error) {
    throw new Error('Database error building calendar events')
  }

  const ministerName = ministerRes.data.name as string
  const assignments = (assignmentsRes.data || []) as AssignmentRow[]
  const rehearsals = (rehearsalsRes.data || []) as RehearsalRow[]
  const quarters = (quartersRes.data || []) as QuarterRow[]

  const rehearsalsByEvent = new Map<string, RehearsalRow>()
  for (const r of rehearsals) {
    rehearsalsByEvent.set(`${r.event_date}_${r.event_type}`, r)
  }

  // Use the most recent quarter for time defaults (same rule as the ICS route).
  const quarter = quarters.sort((a, b) => b.id.localeCompare(a.id))[0]
  if (!quarter) return { ministerName, events: [] }

  // Group assignments by event_date and event_type to handle multiple roles per day.
  const eventMap = new Map<string, AssignmentRow[]>()
  for (const assignment of assignments) {
    const key = `${assignment.event_date}_${assignment.event_type}`
    if (!eventMap.has(key)) eventMap.set(key, [])
    eventMap.get(key)!.push(assignment)
  }

  const events: CalendarEventItem[] = []

  for (const [eventKey, eventAssignments] of eventMap.entries()) {
    const firstAssignment = eventAssignments[0]

    const rehearsal = rehearsalsByEvent.get(eventKey)
    const arrivalTimeStr = rehearsal?.rehearsal_time || getArrivalTime(firstAssignment.event_type, quarter)
    const serviceTimeStr = getServiceTime(firstAssignment.event_type, quarter)
    const { hour: endHour, minute: endMinute } = addMinutesToTime(serviceTimeStr, 90)
    const endTimeStr = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`

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
      arrivalUtc: buildLocalDateTimeUtc(firstAssignment.event_date, arrivalTimeStr),
      endUtc: buildLocalDateTimeUtc(firstAssignment.event_date, endTimeStr),
    })
  }

  return { ministerName, events }
}
