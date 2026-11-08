import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { createAdminClient } from '@/lib/supabase/admin'

const bodySchema = z.object({
  from_minister_id: z.string().uuid(),
  to_minister_id: z.string().uuid(),
}).strict()

export async function POST(request: Request) {
  try {
    const context = await getCurrentMinisterContext({ requireAdmin: true })
    if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || parsed.data.from_minister_id === parsed.data.to_minister_id) {
      return NextResponse.json({ error: 'Selecione integrantes diferentes para a transferência.' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data: source, error: sourceError } = await admin.from('ministers')
      .select('id').eq('id', parsed.data.from_minister_id).eq('church_id', context.churchId).maybeSingle()
    if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 })
    if (!source) return NextResponse.json({ error: 'Integrante de origem não encontrado nesta igreja.' }, { status: 404 })

    const { data, error } = await admin.rpc('wf32_transfer_song_ownership', {
      p_church_id: context.churchId,
      p_from_minister_id: parsed.data.from_minister_id,
      p_to_minister_id: parsed.data.to_minister_id,
      p_actor_minister_id: context.ministerId,
    })
    if (error) {
      if (error.message.includes('WF32_INVALID_TRANSFER_TARGET')) {
        return NextResponse.json({ error: 'O destino precisa ser um integrante ativo desta igreja.' }, { status: 400 })
      }
      if (error.message.includes('WF32_FORBIDDEN')) return NextResponse.json({ error: 'Sem permissão para transferir o acervo.' }, { status: 403 })
      return NextResponse.json({ error: 'Não foi possível transferir o acervo.' }, { status: 500 })
    }
    return NextResponse.json({ transferred_songs: Number(data ?? 0) })
  } catch (error) {
    if (error instanceof AuthContextError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Não foi possível transferir o acervo.' }, { status: 500 })
  }
}
