import { churchLocalDateTimeToUtc, DEFAULT_CHURCH_TIMEZONE } from '@/lib/schedule/wf32-rules'

export type EventType = 'thursday' | 'sunday'

export type QuarterTimeConfig = {
  thursday_arrival_time: string
  thursday_service_time: string
  sunday_arrival_time: string
  sunday_service_time: string
}

export function parseTime(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

export function timeToMinutes(timeStr: string): number {
  const { hour, minute } = parseTime(timeStr)
  return hour * 60 + minute
}

export function addMinutesToTime(timeStr: string, minutes: number): { hour: number; minute: number } {
  const totalMinutes = timeToMinutes(timeStr) + minutes
  const hour = Math.floor(totalMinutes / 60) % 24
  const minute = totalMinutes % 60
  return { hour, minute }
}

export function getArrivalTime(eventType: EventType, quarter: QuarterTimeConfig): string {
  return eventType === 'thursday' ? quarter.thursday_arrival_time : quarter.sunday_arrival_time
}

export function getServiceTime(eventType: EventType, quarter: QuarterTimeConfig): string {
  return eventType === 'thursday' ? quarter.thursday_service_time : quarter.sunday_service_time
}

// Kept for legacy reminder tests/callers; new conversions use the church IANA timezone.
export const BRAZIL_UTC_OFFSET_HOURS = 3

/** Converts a local church date+time into the equivalent UTC instant. */
export function buildLocalDateTimeUtc(
  eventDate: string,
  timeStr: string,
  timeZone = DEFAULT_CHURCH_TIMEZONE,
): Date {
  return churchLocalDateTimeToUtc(eventDate, timeStr.slice(0, 5), timeZone)
}

/** Real UTC instant when ministers should arrive, honoring rehearsal_time overrides. */
export function computeEventArrivalDateTime(input: {
  eventDate: string
  eventType: EventType
  quarter: QuarterTimeConfig
  rehearsalTimeOverride?: string | null
  timeZone?: string
}): Date {
  const arrivalTimeStr = input.rehearsalTimeOverride || getArrivalTime(input.eventType, input.quarter)
  return buildLocalDateTimeUtc(input.eventDate, arrivalTimeStr, input.timeZone)
}

export function dateStringInTimeZone(date: Date, timeZone = DEFAULT_CHURCH_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
