import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { ScheduleAssignment, ScheduleRole } from '@/components/schedule/ScheduleGrid'

/** Papel "Ministro 1" (nome exato) ou primeiro papel da categoria ministro. */
export function resolveMinistro1Role(roles: ScheduleRole[]): ScheduleRole | null {
  const byName = roles.find((r) => /^ministro\s*1$/i.test(r.name.trim()))
  if (byName) return byName

  const ministros = roles
    .filter((r) => r.category === 'ministro')
    .sort((a, b) => a.display_order - b.display_order)

  return ministros[0] ?? null
}

function ministerNameForSlot(
  assignments: ScheduleAssignment[],
  roleId: string,
  eventDate: string,
  eventType: 'thursday' | 'sunday'
): string {
  const row = assignments.find(
    (a) => a.role_id === roleId && a.event_date === eventDate && a.event_type === eventType
  )
  return row?.minister?.name?.trim() || 'A definir'
}

export interface ScheduleWhatsAppInput {
  bimesterName: string
  roles: ScheduleRole[]
  assignments: ScheduleAssignment[]
  dates: { thursday: string[]; sunday: string[] }
}

export function buildPublishedScheduleWhatsAppMessage(input: ScheduleWhatsAppInput): string | null {
  const leadRole = resolveMinistro1Role(input.roles)
  if (!leadRole) return null

  const slots: Array<{ date: string; eventType: 'thursday' | 'sunday' }> = [
    ...input.dates.thursday.map((date) => ({ date, eventType: 'thursday' as const })),
    ...input.dates.sunday.map((date) => ({ date, eventType: 'sunday' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  if (slots.length === 0) return null

  const lines = slots.map(({ date, eventType }) => {
    const dayLabel = eventType === 'thursday' ? 'Quinta' : 'Domingo'
    const dateLabel = format(new Date(`${date}T12:00:00`), 'dd/MM', { locale: ptBR })
    const minister = ministerNameForSlot(input.assignments, leadRole.id, date, eventType)
    return `${dayLabel} ${dateLabel} - ${minister}`
  })

  return [`*${input.bimesterName}*`, '', ...lines].join('\n')
}

export function openScheduleWhatsAppShare(message: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
