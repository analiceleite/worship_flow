import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPublishedReleaseNotes } from '@/lib/release-notes'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const notes = getPublishedReleaseNotes()
  const { data: reads, error } = await supabase
    .from('release_note_reads')
    .select('note_id')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Não foi possível carregar as novidades.' }, { status: 500 })
  const readIds = new Set(((reads ?? []) as { note_id: string }[]).map((read) => read.note_id))
  return NextResponse.json({ notes, unreadCount: notes.filter((note) => note.notify !== false && !readIds.has(note.id)).length })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { noteIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 })
  }
  if (!Array.isArray(body.noteIds) || body.noteIds.length > 200 || !body.noteIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'Lista de novidades inválida.' }, { status: 400 })
  }

  const visibleIds = new Set(getPublishedReleaseNotes().map((note) => note.id))
  const rows = [...new Set(body.noteIds)].filter((id): id is string => visibleIds.has(id as string)).map((note_id) => ({
    user_id: user.id,
    note_id,
  }))
  if (rows.length) {
    const { error } = await supabase.from('release_note_reads').upsert(rows, { onConflict: 'user_id,note_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: 'Não foi possível registrar a leitura.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
