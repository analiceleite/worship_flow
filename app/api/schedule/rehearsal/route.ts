import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

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
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

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
    .eq('church_id', context.churchId)
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
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const payload = (await request.json()) as RehearsalPayload
  const { quarter_id, event_date, event_type, rehearsal_date, rehearsal_time, rehearsal_place } = payload

  if (!quarter_id || !event_date || !event_type) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios ausentes' }, { status: 400 })
  }

  const adminSupabase = createAdminClient()

  if (context.role !== 'admin' && context.role !== 'minister') {
    return NextResponse.json({ error: 'Permissão insuficiente para editar ensaio' }, { status: 403 })
  }

  const { data: quarter, error: quarterError } = await adminSupabase
    .from('schedule_quarters')
    .select('id')
    .eq('id', quarter_id)
    .eq('church_id', context.churchId)
    .maybeSingle()

  if (quarterError) {
    return NextResponse.json({ error: quarterError.message }, { status: 500 })
  }

  if (!quarter) {
    return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
  }

  // UPSERT
  const { data, error } = await adminSupabase
    .from('schedule_rehearsals')
    .upsert([
      {
        church_id: context.churchId,
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
