import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { randomUUID } from 'node:crypto'
import { enqueueScheduleEventNotification, processScheduleEmailQueue } from '@/lib/notifications/schedule-email'

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
    if (body.data.state === 'suspended') {
      const admin = createAdminClient()
      const { data: controls, error: controlsError } = await admin.from('schedule_event_controls')
        .select('quarter_id, event_date, event_type, quarter:schedule_quarters(is_published)')
        .eq('church_id', context.churchId).eq('leader_minister_id', id)
      if (controlsError) {
        leadershipWarning = 'O acesso foi suspenso, mas não foi possível remover a liderança dos eventos.'
      } else if (controls?.length) {
        const { error: clearError } = await admin.from('schedule_event_controls')
          .update({ leader_minister_id: null, updated_at: new Date().toISOString() })
          .eq('church_id', context.churchId).eq('leader_minister_id', id)
        if (clearError) {
          leadershipWarning = 'O acesso foi suspenso, mas não foi possível remover a liderança dos eventos.'
        } else {
          for (const control of controls as Array<{ quarter_id: string; event_date: string; event_type: 'thursday' | 'sunday'; quarter: { is_published: boolean } | { is_published: boolean }[] | null }>) {
            const quarter = Array.isArray(control.quarter) ? control.quarter[0] : control.quarter
            if (!quarter?.is_published) continue
            try {
              await enqueueScheduleEventNotification({
                churchId: context.churchId, quarterId: control.quarter_id,
                eventDate: control.event_date, eventType: control.event_type,
                notificationType: 'schedule_changed', changeId: randomUUID(),
              })
            } catch {
              leadershipWarning = 'O acesso foi suspenso, mas um aviso de alteração de liderança aguarda nova tentativa.'
            }
          }
          try { await processScheduleEmailQueue(200) } catch {
            leadershipWarning = 'O acesso foi suspenso; avisos de alteração de liderança aguardam nova tentativa.'
          }
        }
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
