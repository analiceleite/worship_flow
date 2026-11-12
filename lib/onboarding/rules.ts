import { z } from 'zod'

// WF-38 / WF-26 pure rules, shared by API routes and the UI. No I/O here.

export const CHURCH_OWNER_PASSWORD_MIN = 8

export const publicSignupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(CHURCH_OWNER_PASSWORD_MIN).max(128),
}).strict()

export const churchCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  idempotencyKey: z.string().uuid(),
}).strict()

export type ChurchCreationErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'QUOTA_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_INPUT'
  | 'UNKNOWN'

export function churchCreationHttpError(code: ChurchCreationErrorCode): { status: number; message: string } {
  switch (code) {
    case 'EMAIL_NOT_VERIFIED':
      return { status: 403, message: 'Confirme seu e-mail antes de criar a igreja.' }
    case 'QUOTA_EXCEEDED':
      return {
        status: 409,
        message: 'Esta conta já atingiu o limite de uma igreja. Para ampliar, fale com o suporte da plataforma.',
      }
    case 'IDEMPOTENCY_CONFLICT':
      return { status: 409, message: 'Esta solicitação já foi usada com outros dados. Atualize a página e tente de novo.' }
    case 'INVALID_INPUT':
      return { status: 400, message: 'Revise o nome da igreja e tente novamente.' }
    default:
      return { status: 503, message: 'Não foi possível criar a igreja agora. Tente novamente em instantes.' }
  }
}

export type FirstStepId = 'team' | 'song' | 'schedule'

export type FirstStep = { id: FirstStepId; label: string; done: boolean }

export type FirstStepCounts = { activeMembers: number; songs: number; quarters: number }

// Progress is derived from real data only. Dismissing a suggestion never marks it done,
// and nothing here requires a step before the church can be used.
export function firstSteps(counts: FirstStepCounts): FirstStep[] {
  return [
    { id: 'team', label: 'Convidar sua equipe', done: counts.activeMembers > 1 },
    { id: 'song', label: 'Cadastrar a primeira música', done: counts.songs > 0 },
    { id: 'schedule', label: 'Configurar a primeira escala', done: counts.quarters > 0 },
  ]
}
