import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type EventType = 'thursday' | 'sunday'

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

type QuarterRow = {
  id: string
  thursday_arrival_time: string
  thursday_service_time: string
  sunday_arrival_time: string
  sunday_service_time: string
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

function timeToMinutes(timeStr: string): number {
  const { hour, minute } = parseTime(timeStr)
  return hour * 60 + minute
}

function addMinutesToTime(timeStr: string, minutes: number): { hour: number; minute: number } {
  const totalMinutes = timeToMinutes(timeStr) + minutes
  const hour = Math.floor(totalMinutes / 60) % 24
  const minute = totalMinutes % 60
  return { hour, minute }
}

function getArrivalTime(eventType: EventType, quarter: QuarterRow): string {
  return eventType === 'thursday' ? quarter.thursday_arrival_time : quarter.sunday_arrival_time
}

function getServiceTime(eventType: EventType, quarter: QuarterRow): string {
  return eventType === 'thursday' ? quarter.thursday_service_time : quarter.sunday_service_time
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

    // Build iCalendar manually since `ics` library has limitations with custom properties
    const events: string[] = []

    for (const assignment of assignments) {
      const eventDate = assignment.event_date
      const [year, month, day] = eventDate.split('-').map(Number)

      const rehearsal = rehearsalsByEvent.get(`${eventDate}_${assignment.event_type}`)
      const arrivalTimeStr = rehearsal?.rehearsal_time || getArrivalTime(assignment.event_type, quarter)
      const serviceTimeStr = getServiceTime(assignment.event_type, quarter)

      const { hour: arrivalHour, minute: arrivalMinute } = parseTime(arrivalTimeStr)
      const { hour: endHour, minute: endMinute } = addMinutesToTime(serviceTimeStr, 90)

      const eventLabel = assignment.event_type === 'thursday'
        ? `Escala — Quinta (ensaio ${arrivalTimeStr} / culto ${serviceTimeStr})`
        : `Escala — Domingo (chegada ${arrivalTimeStr} / culto ${serviceTimeStr})`

      // Generate UID based on assignment date and type
      const uid = `${assignment.event_date}_${assignment.event_type}@worship-flow`

      // Format dates for iCal (YYYYMMDDTHHMMSS)
      const dtstart = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(arrivalHour).padStart(2, '0')}${String(arrivalMinute).padStart(2, '0')}00`
      const dtend = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}${String(endMinute).padStart(2, '0')}00`

      // Build VALARM entries
      const alarms = alarmOffsets
        .map((offset: number) => {
          const trigger = `-PT${offset}M`
          return `BEGIN:VALARM
TRIGGER:${trigger}
DURATION:PT15M
REPEAT:1
ACTION:DISPLAY
DESCRIPTION:Lembrete de escala
END:VALARM`
        })
        .join('\n')

      const roleName = assignment.role?.name ?? 'Função'
      const eventType = assignment.event_type === 'thursday' ? 'Ensaio e Culto' : 'Culto'
      const description = `Ministro: ${minister.name}\nFunção: ${roleName}\nTipo: ${eventType}`

      const event = `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${eventLabel}
DESCRIPTION:${description}
${alarms}
END:VEVENT`

      events.push(event)
    }

    const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Worship Flow//Calendar Feed//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Escala de Louvor
X-WR-TIMEZONE:America/Sao_Paulo
X-WR-CALDESC:Sua escala semanal de louvor
${events.join('\n')}
END:VCALENDAR`

    return new NextResponse(icalContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="escala.ics"',
        'Cache-Control': 'no-cache, max-age=300',
      },
    })
  } catch (error) {
    console.error('Error generating calendar feed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
