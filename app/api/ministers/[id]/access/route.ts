import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { processScheduleEmailQueue } from '@/lib/notifications/schedule-email'

const bodySchema = z.object({ state: z.enum(['active', 'suspended']) }).strict()

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getCurrentMinisterContext({ requireAdmin: true })
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const { id } = await params
    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!z.string().uuid().safeParse(id).success || !body.success) {
      return NextResponse.json({ error: 'Informe um integrante e um estado de acesso válidos.' }, { status: 400 })
    }
    const { data, error } = await createAdminClient().rpc('wf04_set_membership_access', {
      p_actor: context.userId, p_church: context.churchId, p_minister: id,
      p_state: body.data.state, p_support: context.isImpersonating,
    })
    if (error) {
      if (error.message.includes('WF04_LAST_ADMIN')) {
        return NextResponse.json({ error: 'Não é possível suspender o último administrador ativo.' }, { status: 409 })
      }
      if (error.message.includes('WF04_INVITATION_REQUIRED')) {
        return NextResponse.json({ error: 'O integrante precisa concluir o aceite do convite.' }, { status: 409 })
      }
      if (error.message.includes('WF04_FORBIDDEN')) {
        return NextResponse.json({ error: 'Sem permissão para alterar este acesso.' }, { status: 403 })
      }
      if (error.message.includes('WF04_UNAVAILABLE')) {
        return NextResponse.json({ error: 'Integrante indisponível.' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Não foi possível alterar o acesso. Tente novamente.' }, { status: 503 })
    }
    let leadershipWarning: string | null = null
    // Migration 043 revokes leadership and records notices atomically with access.
    if (body.data.state === 'suspended') {
      try { await processScheduleEmailQueue(200) } catch {
        leadershipWarning = 'O acesso foi suspenso; avisos estão na fila para nova tentativa.'
      }
    }
    return NextResponse.json({ membership: data, warning: leadershipWarning }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Não foi possível alterar o acesso.' }, { status: 503 })
  }
}
