import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ministerId } = await params

    if (!ministerId) {
      return NextResponse.json(
        { error: 'ID do ministro é obrigatório' },
        { status: 400 }
      )
    }

    let context
    try {
      context = await getCurrentMinisterContext({ requireAdmin: true })
    } catch (error) {
      if (error instanceof AuthContextError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }

    const supabaseAdmin = createAdminClient()

    // Get minister's user_id before deleting
    const { data: ministerToDelete, error: fetchError } = await supabaseAdmin
      .from('ministers')
      .select('user_id')
      .eq('id', ministerId)
      .eq('church_id', context.churchId)
      .single()

    if (fetchError || !ministerToDelete) {
      return NextResponse.json(
        { error: 'Ministro não encontrado' },
        { status: 404 }
      )
    }

    // Cleanup all assigned items and owned-song references atomically, including
    // sequence normalization and revision changes for concurrent editors.
    const { error: repertoireByMinisterError } = await supabaseAdmin.rpc('wf07_remove_minister_items', {
      p_actor: context.userId,
      p_church: context.churchId,
      p_impersonating: Boolean(context.isImpersonating),
      p_minister: ministerId,
    })

    if (repertoireByMinisterError) {
      console.error('Error deleting repertoire by minister:', repertoireByMinisterError)
      return NextResponse.json(
        { error: `Erro ao excluir repertório do ministro: ${repertoireByMinisterError.message}` },
        { status: 400 }
      )
    }

    // RPC also removes references to this minister's songs, under sequence locks.

    // 4) Delete songs owned by minister
    const { error: deleteSongsError } = await supabaseAdmin
      .from('songs')
      .delete()
      .eq('church_id', context.churchId)
      .eq('minister_id', ministerId)

    if (deleteSongsError) {
      console.error('Error deleting minister songs:', deleteSongsError)
      return NextResponse.json(
        { error: `Erro ao excluir músicas do ministro: ${deleteSongsError.message}` },
        { status: 400 }
      )
    }

    // 5) Delete minister profile
    const { error: deleteMinisterError } = await supabaseAdmin
      .from('ministers')
      .delete()
      .eq('id', ministerId)
      .eq('church_id', context.churchId)

    if (deleteMinisterError) {
      console.error('Error deleting minister:', deleteMinisterError)
      return NextResponse.json(
        { error: `Erro ao excluir ministro: ${deleteMinisterError.message}` },
        { status: 400 }
      )
    }

    // 6) Delete auth user if linked
    if (ministerToDelete.user_id) {
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(
        ministerToDelete.user_id
      )

      if (deleteAuthError) {
        console.error('Error deleting auth user:', deleteAuthError)
        return NextResponse.json(
          { error: `Ministro e dados relacionados excluídos, mas falhou ao excluir usuário de autenticação: ${deleteAuthError.message}` },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({
      message: 'Ministro excluído com sucesso. Todas as músicas e itens de repertório associados foram removidos.',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: `Erro inesperado: ${error.message}` },
      { status: 500 }
    )
  }
}
