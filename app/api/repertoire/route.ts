import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'

const eventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }),
  eventName: z.string().max(500),
})
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), songId: z.string().uuid(), ministerId: z.string().uuid().optional() }),
  z.object({ action: z.literal('remove'), itemId: z.string().uuid() }),
  z.object({ action: z.literal('move'), itemId: z.string().uuid(), position: z.number().int().positive() }),
  z.object({ action: z.literal('deleteEvent'), eventId: z.string().uuid() }),
])
const mutationSchema = eventSchema.extend({ expectedRevision: z.string().regex(/^\d+$/), command: commandSchema })
const headers = { 'Cache-Control': 'no-store' }

async function handle(request: Request, mutate: boolean) {
  try {
    const context = await getCurrentMinisterContext()
    const mutation = mutate ? mutationSchema.parse(await request.json()) : null
    const input = mutation ?? eventSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const args = {
      p_actor: context.userId, p_church: context.churchId,
      p_impersonating: Boolean(context.isImpersonating), p_date: input.date, p_name: input.eventName,
    }
    const { data, error } = mutation
      ? await createAdminClient().rpc('wf07_mutate', { ...args, p_revision: mutation.expectedRevision, p_command: mutation.command })
      : await createAdminClient().rpc('wf07_read', args)
    if (error) {
      const mappings = [
        ['WF07_CONFLICT', 409, 'REPERTOIRE_CONFLICT', 'O repertório foi alterado por outra pessoa. Confira a lista atualizada e tente novamente.'],
        ['WF07_DUPLICATE', 409, 'SONG_ALREADY_ADDED', 'Esta música já está no repertório.'],
        ['WF07_FORBIDDEN', 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.'],
        ['WF07_NOT_FOUND', 404, 'NOT_FOUND', 'Item indisponível neste repertório.'],
        ['WF07_INVALID', 400, 'INVALID_INPUT', 'Posição inválida.'],
      ] as const
      const match = mappings.find(([marker]) => error.message.includes(marker))
      if (match) return NextResponse.json({ code: match[2], error: match[3] }, { status: match[1], headers })
      console.error('WF-07 database operation failed:', error.code)
      return NextResponse.json({ error: 'Não foi possível carregar ou salvar o repertório.' }, { status: 500, headers })
    }
    return NextResponse.json(data, { headers })
  } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Dados do repertório inválidos.' }, { status: 400, headers })
    return NextResponse.json({ error: 'Não foi possível acessar o repertório.' }, { status: 500, headers })
  }
}

export const GET = (request: Request) => handle(request, false)
export const POST = (request: Request) => handle(request, true)
