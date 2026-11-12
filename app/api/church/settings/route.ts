import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidTimeZone } from '@/lib/schedule/wf32-rules'
import { reconcileMinistersForQuarter } from '@/lib/google-calendar/reconcile'

const bodySchema = z.object({ timezone: z.string().trim().min(1).max(100) }).strict()

export async function GET() {
  try {
    const context = await getCurrentMinisterContext()
    const { data, error } = await createAdminClient()
      .from('churches')
      .select('timezone')
      .eq('id', context.churchId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ timezone: data?.timezone || 'America/Sao_Paulo' })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Não foi possível carregar o fuso horário.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getCurrentMinisterContext({ requireAdmin: true })
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || !isValidTimeZone(parsed.data?.timezone ?? '')) {
      return NextResponse.json({ error: 'Informe um fuso horário IANA válido.' }, { status: 400 })
    }

    const { data, error } = await createAdminClient()
      .from('churches')
      .update({ timezone: parsed.data.timezone })
      .eq('id', context.churchId)
      .select('timezone')
      .single()
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Não foi possível salvar o fuso horário.' }, { status: 500 })
    }
    const admin = createAdminClient()
    const { data: quarters, error: quartersError } = await admin.from('schedule_quarters')
      .select('id').eq('church_id', context.churchId).eq('is_published', true)
    const calendarErrors: Array<{ quarterId: string; error: string }> = []
    if (quartersError) {
      calendarErrors.push({ quarterId: '', error: quartersError.message })
    } else {
      for (const quarter of quarters ?? []) {
        try {
          const result = await reconcileMinistersForQuarter(quarter.id, context.churchId)
          calendarErrors.push(...result.errors.map(item => ({ quarterId: quarter.id, error: item.error })))
        } catch (syncError) {
          calendarErrors.push({ quarterId: quarter.id, error: syncError instanceof Error ? syncError.message : 'Falha ao sincronizar calendário.' })
        }
      }
    }
    return NextResponse.json({ timezone: data.timezone, calendar_sync: { errors: calendarErrors } })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Não foi possível salvar o fuso horário.' }, { status: 500 })
  }
}
