import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function PATCH(request: Request) {
  try {
    let context
    try {
      context = await getCurrentMinisterContext({ churchId: request.headers.get('x-wf-church-id') })
    } catch (error) {
      if (error instanceof AuthContextError) {
        return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE })
      }
      throw error
    }

    if (context.isImpersonating) {
      return NextResponse.json(
        { error: 'Preferências pessoais não podem ser alteradas em contexto de suporte.' },
        { status: 403, headers: NO_STORE }
      )
    }

    const body = await request.json()
    const {
      calendar_alarm_offsets_minutes,
      email_reminders_enabled,
      email_reminder_offsets_minutes,
      optional_notifications_paused,
    } = body

    const admin = createAdminClient()

    const updateData: Record<string, unknown> = {}

    if (calendar_alarm_offsets_minutes !== undefined) {
      if (!Array.isArray(calendar_alarm_offsets_minutes) ||
          !calendar_alarm_offsets_minutes.every((v: unknown) => typeof v === 'number' && v > 0)) {
        return NextResponse.json({ error: 'Invalid alarm offsets' }, { status: 400, headers: NO_STORE })
      }
      updateData.calendar_alarm_offsets_minutes = calendar_alarm_offsets_minutes
    }

    if (email_reminders_enabled !== undefined) {
      updateData.email_reminders_enabled = Boolean(email_reminders_enabled)
    }

    if (email_reminder_offsets_minutes !== undefined) {
      if (!Array.isArray(email_reminder_offsets_minutes) ||
          !email_reminder_offsets_minutes.every((v: unknown) => typeof v === 'number' && v > 0)) {
        return NextResponse.json({ error: 'Invalid email reminder offsets' }, { status: 400, headers: NO_STORE })
      }
      updateData.email_reminder_offsets_minutes = email_reminder_offsets_minutes
    }

    let globalPause: boolean | undefined
    if (optional_notifications_paused !== undefined) {
      if (typeof optional_notifications_paused !== 'boolean') {
        return NextResponse.json({ error: 'Invalid optional notification preference' }, { status: 400, headers: NO_STORE })
      }
      globalPause = optional_notifications_paused
    }

    if (Object.keys(updateData).length === 0 && globalPause === undefined) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await admin
        .from('ministers')
        .update(updateData)
        .eq('id', context.ministerId)
        .eq('church_id', context.churchId)

      if (updateError) {
        return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500, headers: NO_STORE })
      }
    }

    if (globalPause !== undefined) {
      const { error: pauseError } = await admin
        .from('user_profiles')
        .update({ optional_notifications_paused: globalPause, updated_at: new Date().toISOString() })
        .eq('user_id', context.userId)

      if (pauseError) {
        return NextResponse.json({ error: 'Failed to update notification pause' }, { status: 500, headers: NO_STORE })
      }
    }

    if (calendar_alarm_offsets_minutes !== undefined) {
      try {
        await reconcileMinisterCalendar(context.ministerId) // no-op se não conectado ao Google Calendar
      } catch (syncError) {
        console.error('Erro ao sincronizar alarmes no Google Calendar:', syncError)
      }
    }

    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (error) {
    console.error('Error updating preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
  }
}
