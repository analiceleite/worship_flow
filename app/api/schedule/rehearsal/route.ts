import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type EventType = 'thursday' | 'sunday'

interface RehearsalPayload {
  quarter_id?: string
  event_date?: string
  event_type?: EventType
  rehearsal_date?: string | null
  rehearsal_time?: string | null
  rehearsal_place?: string | null
}

// GET: /api/schedule/rehearsal?quarter_id=...&event_date=...&event_type=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const quarter_id = searchParams.get('quarter_id')
  const event_date = searchParams.get('event_date')
  const event_type = searchParams.get('event_type')

  if (!quarter_id || !event_date || !event_type) {
    if (!quarter_id) {
      return NextResponse.json({ error: 'Parâmetro quarter_id é obrigatório' }, { status: 400 })
    }
  }

  const supabase = createAdminClient()
  const baseQuery = supabase
    .from('schedule_rehearsals')
    .select('*')
    .eq('quarter_id', quarter_id)

  if (event_date && event_type) {
    const { data, error } = await baseQuery
      .eq('event_date', event_date)
      .eq('event_type', event_type)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rehearsal: data ?? null })
  }

  const { data, error } = await baseQuery.order('event_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rehearsals: data ?? [] })
}

// PATCH: atualiza ou cria dados do ensaio
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = (await request.json()) as RehearsalPayload
  const { quarter_id, event_date, event_type, rehearsal_date, rehearsal_time, rehearsal_place } = payload

  if (!quarter_id || !event_date || !event_type) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios ausentes' }, { status: 400 })
  }

  const adminSupabase = createAdminClient()

  const { data: editor, error: editorError } = await adminSupabase
    .from('ministers')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (editorError) {
    return NextResponse.json({ error: editorError.message }, { status: 500 })
  }

  if (!editor || (editor.role !== 'admin' && editor.role !== 'minister')) {
    return NextResponse.json({ error: 'Permissão insuficiente para editar ensaio' }, { status: 403 })
  }

  // UPSERT
  const { data, error } = await adminSupabase
    .from('schedule_rehearsals')
    .upsert([
      {
        quarter_id,
        event_date,
        event_type,
        rehearsal_date,
        rehearsal_time,
        rehearsal_place,
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: 'quarter_id,event_date,event_type' })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rehearsal: data })
}
