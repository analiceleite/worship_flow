import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  parseTime,
  addMinutesToTime,
  getArrivalTime,
  getServiceTime,
  type EventType,
  type QuarterTimeConfig,
} from '@/lib/schedule/event-time'

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

type QuarterRow = QuarterTimeConfig & {
  id: string
}

// Escapes a TEXT value per RFC 5545 (3.3.11): backslash, then semicolon, then literal newlines.
// Order matters — escaping backslash first avoids double-escaping the backslashes we just inserted.
function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/\r\n|\n|\r/g, '\\n')
}

// Folds a content line at 75 octets per RFC 5545 (3.1), continuing with CRLF + a leading space.
// Splits on UTF-8 byte boundaries so multi-byte characters (á, ã, ç, —) are never cut in half.
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) {
    return line
  }

  const chunks: string[] = []
  let offset = 0
  let limit = 75

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length)
    // Back off while we're in the middle of a multi-byte UTF-8 sequence (continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--
    }
    chunks.push(bytes.subarray(offset, end).toString('utf8'))
    offset = end
    limit = 74 // subsequent lines start with a folding space, leaving 74 octets for content
  }

  return chunks.join('\r\n ')
}

export async function GET(
  request: Request,
  { params }: { params: { token?: string } }
) {
  try {
    let token = params?.token

    // Fallback: try to extract token from URL path if params.token is undefined
    if (!token) {
      const url = new URL(request.url)
      const pathMatch = url.pathname.match(/\/api\/calendar\/([a-f0-9\-]+)/)
      if (pathMatch) {
        token = pathMatch[1]
      }
    }

    console.log('[DEBUG] Calendar feed request:', { token, paramType: typeof token, pathname: new URL(request.url).pathname })

    if (!token || typeof token !== 'string') {
      console.error('[DEBUG] Invalid token format - could not extract token')
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: minister, error: ministerError } = await admin
      .from('ministers')
      .select('id, name, email, calendar_feed_enabled, calendar_alarm_offsets_minutes')
      .eq('calendar_token', token)
      .single()

    console.log('[DEBUG] Query result:', { ministerError, ministerFound: !!minister, token })

    if (ministerError || !minister) {
      console.error('[DEBUG] Minister not found:', { error: ministerError, token })
      return NextResponse.json({ error: 'Not found', debug: ministerError?.message }, { status: 404 })
    }

    if (!minister.calendar_feed_enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [assignmentsRes, rehearsalsRes, quartersRes] = await Promise.all([
      admin
        .from('schedule_assignments')
        .select('minister_id, event_date, event_type, role:schedule_roles(name)')
        .eq('minister_id', minister.id)
        .order('event_date', { ascending: true }),
      admin
        .from('schedule_rehearsals')
        .select('event_date, event_type, rehearsal_time'),
      admin.from('schedule_quarters').select('*'),
    ])

    if (assignmentsRes.error || rehearsalsRes.error || quartersRes.error) {
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const assignments = (assignmentsRes.data || []) as AssignmentRow[]
    const rehearsals = (rehearsalsRes.data || []) as RehearsalRow[]
    const quarters = (quartersRes.data || []) as QuarterRow[]

    const rehearsalsByEvent = new Map<string, RehearsalRow>()
    for (const r of rehearsals) {
      rehearsalsByEvent.set(`${r.event_date}_${r.event_type}`, r)
    }

    // Use the most recent quarter for time defaults
    const quarter = quarters.sort((a, b) => b.id.localeCompare(a.id))[0]
    if (!quarter) {
      return NextResponse.json({ error: 'No quarter found' }, { status: 500 })
    }

    const alarmOffsets = (minister.calendar_alarm_offsets_minutes || [720, 60])
      .map((v: unknown) => typeof v === 'string' ? parseInt(v, 10) : v)
      .filter((v: number) => !isNaN(v) && v > 0)
      .sort((a: number, b: number) => b - a)

    // Group assignments by event_date and event_type to handle multiple roles per day
    const eventMap = new Map<string, AssignmentRow[]>()
    for (const assignment of assignments) {
      const key = `${assignment.event_date}_${assignment.event_type}`
      if (!eventMap.has(key)) {
        eventMap.set(key, [])
      }
      eventMap.get(key)!.push(assignment)
    }

    // Build iCalendar manually since `ics` library has limitations with custom properties
    const events: string[] = []

    for (const [eventKey, eventAssignments] of eventMap.entries()) {
      const firstAssignment = eventAssignments[0]
      const eventDate = firstAssignment.event_date
      const [year, month, day] = eventDate.split('-').map(Number)

      const rehearsal = rehearsalsByEvent.get(eventKey)
      const arrivalTimeStr = rehearsal?.rehearsal_time || getArrivalTime(firstAssignment.event_type, quarter)
      const serviceTimeStr = getServiceTime(firstAssignment.event_type, quarter)

      const { hour: arrivalHour, minute: arrivalMinute } = parseTime(arrivalTimeStr)
      const { hour: endHour, minute: endMinute } = addMinutesToTime(serviceTimeStr, 90)

      // Collect all roles for this event
      const roleNames = eventAssignments
        .map(a => a.role?.name ?? 'Função')
        .filter((role, index, self) => self.indexOf(role) === index) // Remove duplicates

      const roleList = roleNames.join(', ')
      const eventLabel = firstAssignment.event_type === 'thursday'
        ? `Escala — Quinta: ${roleList} (ensaio ${arrivalTimeStr} / culto ${serviceTimeStr})`
        : `Escala — Domingo: ${roleList} (chegada ${arrivalTimeStr} / culto ${serviceTimeStr})`

      // Generate UID based on assignment date and type
      const uid = eventKey + '@worship-flow'

      // Format dates for iCal (YYYYMMDDTHHMMSS)
      const dtstart = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(arrivalHour).padStart(2, '0')}${String(arrivalMinute).padStart(2, '0')}00`
      const dtend = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}${String(endMinute).padStart(2, '0')}00`

      // Build VALARM entries (each as an array of content lines)
      const alarmLines = alarmOffsets.flatMap((offset: number) => [
        'BEGIN:VALARM',
        `TRIGGER:-PT${offset}M`,
        'DURATION:PT15M',
        'REPEAT:1',
        'ACTION:DISPLAY',
        'DESCRIPTION:Lembrete de escala',
        'END:VALARM',
      ])

      const eventType = firstAssignment.event_type === 'thursday' ? 'Ensaio e Culto' : 'Culto'
      const description = `Ministro: ${escapeICalText(minister.name)}\\nFunções: ${escapeICalText(roleList)}\\nTipo: ${eventType}`

      const eventLines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${escapeICalText(eventLabel)}`,
        `DESCRIPTION:${description}`,
        ...alarmLines,
        'END:VEVENT',
      ]

      events.push(eventLines.map(foldLine).join('\r\n'))
    }

    const calendarLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Worship Flow//Calendar Feed//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Escala de Louvor',
      'X-WR-TIMEZONE:America/Sao_Paulo',
      'X-WR-CALDESC:Sua escala semanal de louvor',
    ]

    const icalContent = calendarLines.map(foldLine).join('\r\n') +
      '\r\n' + events.join('\r\n') +
      '\r\nEND:VCALENDAR\r\n'

    return new NextResponse(icalContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-cache, max-age=300',
      },
    })
  } catch (error) {
    console.error('Error generating calendar feed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
