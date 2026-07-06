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

// America/Sao_Paulo has had no DST since 2019 -> fixed UTC-3 offset. Documented assumption;
// if Brazil ever reinstates DST this constant needs to become date-aware.
export const BRAZIL_UTC_OFFSET_HOURS = 3

/** Converts a local (America/Sao_Paulo) date+time into the equivalent UTC instant. */
export function buildLocalDateTimeUtc(eventDate: string, timeStr: string): Date {
  const [year, month, day] = eventDate.split('-').map(Number)
  const { hour, minute } = parseTime(timeStr)
  return new Date(Date.UTC(year, month - 1, day, hour + BRAZIL_UTC_OFFSET_HOURS, minute, 0))
}

/** Real UTC instant when ministers should arrive, honoring rehearsal_time overrides. */
export function computeEventArrivalDateTime(input: {
  eventDate: string
  eventType: EventType
  quarter: QuarterTimeConfig
  rehearsalTimeOverride?: string | null
}): Date {
  const arrivalTimeStr = input.rehearsalTimeOverride || getArrivalTime(input.eventType, input.quarter)
  return buildLocalDateTimeUtc(input.eventDate, arrivalTimeStr)
}
