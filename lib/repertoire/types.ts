import type { RepertoireItem } from '@/lib/types'

export interface RepertoireSnapshot {
  items: RepertoireItem[]
  total: number
  revision: string
}

export type RepertoireCommand =
  | { action: 'add'; songId: string; ministerId?: string }
  | { action: 'remove'; itemId: string }
  | { action: 'move'; itemId: string; position: number }
  | { action: 'deleteEvent'; eventId: string }
