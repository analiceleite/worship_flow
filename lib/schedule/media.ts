export type ScheduleTimes = {
  thursday_arrival_time: string | null
  thursday_service_time: string | null
  sunday_arrival_time: string | null
  sunday_service_time: string | null
}

type Assignment = {
  minister_id: string | null
  event_date: string
  event_type: 'thursday' | 'sunday'
  role_id: string
  is_trainee: boolean
}

type Role = { id: string; name: string; display_order: number }

export function getMediaCommitments(assignments: Assignment[], roles: Role[], ministerId: string, today: string) {
  const own = assignments.filter(item => item.minister_id === ministerId)
  const rolesById = new Map(roles.map(role => [role.id, role]))
  const groups = new Map<string, {
    date: string
    eventType: Assignment['event_type']
    roles: Array<{ id: string; name: string; isTrainee: boolean; order: number }>
  }>()
  for (const item of own) {
    if (item.event_date < today) continue
    const key = `${item.event_date}_${item.event_type}`
    const group = groups.get(key) ?? { date: item.event_date, eventType: item.event_type, roles: [] }
    const role = rolesById.get(item.role_id)
    group.roles.push({ id: item.role_id, name: role?.name ?? 'Função não informada', isTrainee: item.is_trainee, order: role?.display_order ?? 999 })
    groups.set(key, group)
  }
  return {
    total: own.length,
    upcoming: Array.from(groups.values())
      .sort((a, b) => a.date.localeCompare(b.date) || a.eventType.localeCompare(b.eventType))
      .map(group => ({ ...group, roles: group.roles.sort((a, b) => a.order - b.order) })),
  }
}

export function getScheduleTimeLabels(eventType: Assignment['event_type'], times: ScheduleTimes) {
  const arrival = eventType === 'thursday' ? times.thursday_arrival_time : times.sunday_arrival_time
  const service = eventType === 'thursday' ? times.thursday_service_time : times.sunday_service_time
  return { arrival: arrival?.slice(0, 5) || null, service: service?.slice(0, 5) || null }
}
