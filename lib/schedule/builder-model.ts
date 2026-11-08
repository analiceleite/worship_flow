import type { BimesterSummary } from '@/components/schedule/BimesterForm'
import type { ScheduleAssignment, ScheduleEventControl, ScheduleRehearsal, ScheduleRole } from '@/components/schedule/ScheduleGrid'

export type BuilderPeriod = BimesterSummary & {
  thursday_arrival_time?: string | null
  thursday_service_time?: string | null
  sunday_arrival_time?: string | null
  sunday_service_time?: string | null
}

export interface BuilderData {
  quarter: BuilderPeriod
  roles: ScheduleRole[]
  assignments: ScheduleAssignment[]
  event_controls: ScheduleEventControl[]
  active_ministers: Array<{ id: string; name: string }>
  dates: { thursday: string[]; sunday: string[] }
}

export interface BuilderEvent {
  key: string
  date: string
  type: 'thursday' | 'sunday'
  assignments: ScheduleAssignment[]
  control?: ScheduleEventControl
  rehearsal?: ScheduleRehearsal
  total: number
  filled: number
  missing: string[]
  cancelled: boolean
}

export type EventFilter = 'all' | 'pending' | 'cancelled'
export type TypeFilter = 'all' | 'thursday' | 'sunday'

export function buildEvents(data: BuilderData, rehearsals: ScheduleRehearsal[]): BuilderEvent[] {
  const grouped = new Map<string, ScheduleAssignment[]>()
  const roleById = new Map(data.roles.map(role => [role.id, role]))
  for (const assignment of data.assignments) {
    const key = `${assignment.event_date}_${assignment.event_type}`
    const group = grouped.get(key) ?? []
    group.push(assignment)
    grouped.set(key, group)
  }
  const controls = new Map(data.event_controls.map(item => [`${item.event_date}_${item.event_type}`, item]))
  const rehearsalByKey = new Map(rehearsals.map(item => [`${item.event_date}_${item.event_type}`, item]))
  return [...grouped.entries()].map(([key, assignments]) => {
    const sorted = [...assignments].sort((a, b) => (roleById.get(a.role_id)?.display_order ?? 999) - (roleById.get(b.role_id)?.display_order ?? 999))
    const control = controls.get(key)
    return {
      key, date: sorted[0].event_date, type: sorted[0].event_type, assignments: sorted, control,
      rehearsal: rehearsalByKey.get(key), total: sorted.length,
      filled: sorted.filter(item => Boolean(item.minister_id)).length,
      missing: sorted.filter(item => !item.minister_id).map(item => roleById.get(item.role_id)?.name ?? 'Função'),
      cancelled: control?.status === 'cancelled',
    }
  }).sort((a, b) => a.key.localeCompare(b.key))
}

export function filterEvents(events: BuilderEvent[], filter: EventFilter, type: TypeFilter) {
  return events.filter(event => (type === 'all' || event.type === type)
    && (filter === 'cancelled' ? event.cancelled : !event.cancelled && (filter !== 'pending' || event.filled < event.total)))
}

export function summarizeEvents(events: BuilderEvent[]) {
  const active = events.filter(event => !event.cancelled)
  return {
    events: active.length,
    cancelled: events.length - active.length,
    filled: active.reduce((sum, event) => sum + event.filled, 0),
    total: active.reduce((sum, event) => sum + event.total, 0),
    pendingEvents: active.filter(event => event.filled < event.total).length,
    withoutLeader: active.filter(event => !event.control?.leader_minister_id).length,
  }
}

export function eventTime(period: BuilderPeriod, type: BuilderEvent['type'], field: 'arrival' | 'service') {
  return period[`${type}_${field}_time`]?.slice(0, 5) ?? 'Não informado'
}

export function clearUnassignedLeaders(data: BuilderData, assignment: ScheduleAssignment): BuilderData {
  const assignments = data.assignments.map(item => item.id === assignment.id ? assignment : item)
  return { ...data, assignments, event_controls: data.event_controls.map(control => {
    if (!control.leader_minister_id || assignments.some(item => item.event_date === control.event_date
      && item.event_type === control.event_type && item.minister_id === control.leader_minister_id)) return control
    return { ...control, leader_minister_id: null, leader: null }
  }) }
}
