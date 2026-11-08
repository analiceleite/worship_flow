export const DEFAULT_CHURCH_TIMEZONE = 'America/Sao_Paulo'

export function quarterRangesOverlap(
  first: { start_date: string; end_date: string },
  second: { start_date: string; end_date: string },
) {
  return first.start_date <= second.end_date && first.end_date >= second.start_date
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(value.year), month: Number(value.month), day: Number(value.day),
    hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second),
  }
}

/** Converts local church date/time to UTC and rejects DST gaps or ambiguous local times. */
export function churchLocalDateTimeToUtc(date: string, time: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new Error('Fuso horário da igreja inválido')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Data ou horário inválido')
  }

  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error('Data inválida')
  }
  const expected = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = expected

  // Resolve offset by comparing rendered wall time; iterate for zones with DST.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedDateTimeParts(new Date(candidate), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    candidate += expected - represented
  }

  const matches = zonedDateTimeParts(new Date(candidate), timeZone)
  if (matches.year !== year || matches.month !== month || matches.day !== day || matches.hour !== hour || matches.minute !== minute) {
    throw new Error('Este horário local não existe por causa da mudança de fuso horário')
  }

  // A repeated wall time has two valid UTC instants during a DST rollback.
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 15) {
    if (deltaMinutes === 0) continue
    const other = zonedDateTimeParts(new Date(candidate + deltaMinutes * 60_000), timeZone)
    if (other.year === year && other.month === month && other.day === day && other.hour === hour && other.minute === minute) {
      throw new Error('Este horário local é ambíguo por causa da mudança de fuso horário')
    }
  }
  return new Date(candidate)
}

export interface ConflictInterval {
  eventDate: string
  eventType: 'thursday' | 'sunday'
  start: Date
  end: Date
}

export function intervalsOverlap(first: ConflictInterval, second: ConflictInterval) {
  return first.start < second.end && first.end > second.start
}
