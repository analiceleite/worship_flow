import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const context = await getCurrentMinisterContext()
    const admin = createAdminClient()
    // Explicit batches avoid the REST row limit, including in large song catalogs.
    async function all(table: 'songs' | 'ministers') {
      const rows = []
      for (let start = 0; ; start += 500) {
        const columns = table === 'songs' ? 'id,title,artist,tone,minister_id' : 'id,name,instrument'
        const { data, error } = await admin.from(table).select(columns).eq('church_id', context.churchId)
          .order('id').range(start, start + 499)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < 500) return rows
      }
    }
    const [songs, ministers] = await Promise.all([all('songs'), all('ministers')])
    return NextResponse.json({ songs, ministers }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: 'Não foi possível carregar músicas e ministros.' }, {
      status: error instanceof AuthContextError ? error.status : 500, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
