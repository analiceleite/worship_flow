import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

// A church administrator cannot delete a person's global identity or historical
// musical data. Keep the old endpoint fail-closed for clients not yet updated.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getCurrentMinisterContext({ requireAdmin: true })
    const { id } = await params
    const { data, error } = await createAdminClient().from('ministers').select('id')
      .eq('id', id).eq('church_id', context.churchId).maybeSingle()
    if (error) return NextResponse.json({ error: 'Não foi possível consultar o integrante.' }, { status: 503 })
    if (!data) return NextResponse.json({ error: 'Integrante não encontrado.' }, { status: 404 })
    return NextResponse.json({
      error: 'A exclusão definitiva está desabilitada. Suspenda o acesso para preservar a conta, as músicas e o histórico.',
    }, { status: 409 })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Não foi possível verificar o integrante.' }, { status: 503 })
  }
}
