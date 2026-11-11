import type { BuilderData, BuilderEvent } from './builder-model'
import type { ScheduleAssignment, ScheduleRole } from '@/components/schedule/ScheduleGrid'

// Funções puras usadas pela tela Montar escala (SPEC/PLAN montar-escala-admin).
// Não fazem chamadas de rede e não alteram dados: só calculam o que a tela mostra.

export type CopyMode = 'empty' | 'replace'

export interface CopyItem {
  assignment: ScheduleAssignment
  ministerId: string
  ministerName: string
  ministerAvatar: string | null
  isTrainee: boolean
}

export interface CopyPreview {
  /** Vagas em aberto que receberão alguém da equipe de origem. */
  fill: CopyItem[]
  /** Vagas já preenchidas com outra pessoa; só entram no modo "replace". */
  replace: CopyItem[]
  /** Vagas que não mudam (já iguais, sem pessoa na origem ou mantidas pelo modo). */
  keep: ScheduleAssignment[]
}

const cancelledKey = (item: { event_date: string; event_type: string }) => `${item.event_date}_${item.event_type}`

/** Quantidade de cultos ativos do período em que cada pessoa está escalada. */
export function ministerLoad(data: BuilderData): Map<string, number> {
  const cancelled = new Set(data.event_controls.filter(control => control.status === 'cancelled').map(cancelledKey))
  const eventsByMinister = new Map<string, Set<string>>()
  for (const assignment of data.assignments) {
    if (!assignment.minister_id) continue
    const key = cancelledKey(assignment)
    if (cancelled.has(key)) continue
    const events = eventsByMinister.get(assignment.minister_id) ?? new Set<string>()
    events.add(key)
    eventsByMinister.set(assignment.minister_id, events)
  }
  return new Map([...eventsByMinister].map(([ministerId, events]) => [ministerId, events.size]))
}

/** Nomes das funções que a pessoa já ocupa neste culto, ignorando a vaga que está sendo editada. */
export function rolesInSameEvent(event: BuilderEvent, roles: ScheduleRole[], ministerId: string, exceptAssignmentId: string): string[] {
  const names = new Map(roles.map(role => [role.id, role.name]))
  return event.assignments
    .filter(assignment => assignment.id !== exceptAssignmentId && assignment.minister_id === ministerId)
    .map(assignment => names.get(assignment.role_id) ?? 'Função')
}

/** Ordena do menos escalado para o mais escalado, mantendo a ordem original nos empates. */
export function sortByLoad<T extends { id: string }>(items: T[], load: Map<string, number>): T[] {
  return [...items].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))
}

/** Calcula o que a cópia de equipe faria, sem salvar nada. */
export function planTeamCopy(source: BuilderEvent, target: BuilderEvent, mode: CopyMode): CopyPreview {
  const preview: CopyPreview = { fill: [], replace: [], keep: [] }
  if (target.cancelled || source.cancelled) {
    preview.keep = [...target.assignments]
    return preview
  }
  const sourceByRole = new Map(source.assignments.map(assignment => [assignment.role_id, assignment]))
  for (const assignment of target.assignments) {
    const from = sourceByRole.get(assignment.role_id)
    if (!from?.minister_id || !from.minister || from.minister_id === assignment.minister_id) {
      preview.keep.push(assignment)
      continue
    }
    const item: CopyItem = {
      assignment,
      ministerId: from.minister_id,
      ministerName: from.minister.name,
      ministerAvatar: from.minister.avatar_url ?? null,
      isTrainee: from.is_trainee,
    }
    if (!assignment.minister_id) preview.fill.push(item)
    else if (mode === 'replace') preview.replace.push(item)
    else preview.keep.push(assignment)
  }
  return preview
}
