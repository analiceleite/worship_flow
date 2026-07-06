import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      calendar_alarm_offsets_minutes,
      email_reminders_enabled,
      email_reminder_offsets_minutes,
    } = body

    const admin = createAdminClient()

    const { data: minister } = await admin
      .from('ministers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!minister) {
      return NextResponse.json({ error: 'Minister not found' }, { status: 404 })
    }

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
      .eq('id', minister.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    if (calendar_alarm_offsets_minutes !== undefined) {
      try {
        await reconcileMinisterCalendar(minister.id) // no-op se não conectado ao Google Calendar
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
