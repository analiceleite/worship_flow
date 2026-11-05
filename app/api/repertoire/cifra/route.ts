import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  try {
    const context = await getCurrentMinisterContext()
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get('songId'))
    const { data, error } = await createAdminClient().from('songs').select('*')
      .eq('church_id', context.churchId).eq('id', id).maybeSingle()
    if (error) throw error
    return NextResponse.json(data ?? { error: 'Música indisponível.' }, {
      status: data ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const status = error instanceof AuthContextError ? error.status : error instanceof z.ZodError ? 400 : 500
    return NextResponse.json({ error: 'Não foi possível carregar a cifra.' }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
