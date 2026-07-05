import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    const { data: minister } = await admin
      .from('ministers')
      .select('id, calendar_token')
      .eq('user_id', user.id)
      .single()

    if (!minister) {
      return NextResponse.json({ error: 'Minister not found' }, { status: 404 })
    }

    const token = randomUUID()

    const { error: updateError } = await admin
      .from('ministers')
      .update({ calendar_token: token })
      .eq('id', minister.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
    const https_url = `${baseUrl}/api/calendar/${token}`
    const webcal_url = https_url.replace('http://', 'webcal://').replace('https://', 'webcal://')

    return NextResponse.json({
      token,
      https_url,
      webcal_url,
    })
  } catch (error) {
    console.error('Error generating calendar token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { calendar_alarm_offsets_minutes, calendar_feed_enabled, email_reminders_enabled } = body

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

    if (calendar_feed_enabled !== undefined) {
      updateData.calendar_feed_enabled = Boolean(calendar_feed_enabled)
    }

    if (email_reminders_enabled !== undefined) {
      updateData.email_reminders_enabled = Boolean(email_reminders_enabled)
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating calendar preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
