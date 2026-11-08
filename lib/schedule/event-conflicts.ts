import { addMinutesToTime, buildLocalDateTimeUtc, getArrivalTime, getServiceTime, type EventType, type QuarterTimeConfig } from '@/lib/schedule/event-time'

export interface EventTimeConfig extends QuarterTimeConfig {
  id: string
  start_date: string
  end_date: string
}

export interface ScheduleConflictEvent {
  quarter_id: string
  event_date: string
  event_type: EventType
  rehearsal_date?: string | null
  rehearsal_time?: string | null
}

export function getScheduleEventInterval(input: {
  event: ScheduleConflictEvent
  quarter: EventTimeConfig
  timeZone: string
}) {
  const startDate = input.event.rehearsal_date || input.event.event_date
  const startTime = input.event.rehearsal_time || getArrivalTime(input.event.event_type, input.quarter)
  const serviceTime = getServiceTime(input.event.event_type, input.quarter)
  const serviceEnd = addMinutesToTime(serviceTime, 90)
  const endTime = `${String(serviceEnd.hour).padStart(2, '0')}:${String(serviceEnd.minute).padStart(2, '0')}`
  let endDate = input.event.event_date
  if (serviceEnd.hour < Number(serviceTime.slice(0, 2))) {
    const [year, month, day] = endDate.split('-').map(Number)
    endDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  }
  return {
    eventDate: input.event.event_date,
    eventType: input.event.event_type,
    start: buildLocalDateTimeUtc(startDate, startTime, input.timeZone),
    end: buildLocalDateTimeUtc(endDate, endTime, input.timeZone),
  }
}
