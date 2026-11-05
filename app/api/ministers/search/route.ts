import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

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
  const rawQuery = (searchParams.get('query') ?? '').trim()
  const limit = Number(searchParams.get('limit') ?? '30')
  const role = searchParams.get('role')

  const adminSupabase = createAdminClient()
  let query = adminSupabase
    .from('ministers')
    .select('id, name, email, avatar_url')
    .eq('church_id', context.churchId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(Number.isNaN(limit) ? 30 : Math.min(Math.max(limit, 1), 100))

  if (role === 'midia') {
    query = query.eq('role', 'midia')
  }

  if (rawQuery) {
    query = query.ilike('name', `%${rawQuery}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ministers: data ?? [] })
}
