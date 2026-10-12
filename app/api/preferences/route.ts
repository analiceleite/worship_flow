import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

export async function PATCH(request: Request) {
  try {
    let context
    try {
      context = await getCurrentMinisterContext()
    } catch (error) {
      if (error instanceof AuthContextError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }

    const body = await request.json()
    const {
      calendar_alarm_offsets_minutes,
      email_reminders_enabled,
      email_reminder_offsets_minutes,
    } = body

    const admin = createAdminClient()

    const updateData: Record<string, unknown> = {}

    if (calendar_alarm_offsets_minutes !== undefined) {
      if (!Array.isArray(calendar_alarm_offsets_minutes) ||
          !calendar_alarm_offsets_minutes.every((v: unknown) => typeof v === 'number' && v > 0)) {
        return NextResponse.json({ error: 'Invalid alarm offsets' }, { status: 400 })
      }
      updateData.calendar_alarm_offsets_minutes = calendar_alarm_offsets_minutes
    }

    if (email_reminders_enabled !== undefined) {
      updateData.email_reminders_enabled = Boolean(email_reminders_enabled)
    }

    if (email_reminder_offsets_minutes !== undefined) {
      if (!Array.isArray(email_reminder_offsets_minutes) ||
          !email_reminder_offsets_minutes.every((v: unknown) => typeof v === 'number' && v > 0)) {
        return NextResponse.json({ error: 'Invalid email reminder offsets' }, { status: 400 })
      }
      updateData.email_reminder_offsets_minutes = email_reminder_offsets_minutes
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from('ministers')
      .update(updateData)
      .eq('id', context.ministerId)
      .eq('church_id', context.churchId)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    if (calendar_alarm_offsets_minutes !== undefined) {
      try {
        await reconcileMinisterCalendar(context.ministerId) // no-op se não conectado ao Google Calendar
      } catch (syncError) {
        console.error('Erro ao sincronizar alarmes no Google Calendar:', syncError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
