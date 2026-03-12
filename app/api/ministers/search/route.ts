import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const rawQuery = (searchParams.get('query') ?? '').trim()
  const limit = Number(searchParams.get('limit') ?? '30')

  const adminSupabase = createAdminClient()
  let query = adminSupabase
    .from('ministers')
    .select('id, name, email')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(Number.isNaN(limit) ? 30 : Math.min(Math.max(limit, 1), 100))

  if (rawQuery) {
    query = query.ilike('name', `%${rawQuery}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ministers: data ?? [] })
}
