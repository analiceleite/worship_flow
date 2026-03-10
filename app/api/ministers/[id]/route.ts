import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

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

    const cookieStore = await cookies()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    // Create Supabase client with SSR
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // Check if current user is admin
    const { data: currentMinister } = await supabase
      .from('ministers')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!currentMinister || currentMinister.role !== 'admin') {
      return NextResponse.json(
        { error: 'Apenas administradores podem excluir ministros' },
        { status: 403 }
      )
    }

    // Get minister's user_id before deleting
    const { data: ministerToDelete, error: fetchError } = await supabase
      .from('ministers')
      .select('user_id')
      .eq('id', ministerId)
      .single()

    if (fetchError || !ministerToDelete) {
      return NextResponse.json(
        { error: 'Ministro não encontrado' },
        { status: 404 }
      )
    }

    // Create admin client to delete auth user
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Service Role Key não configurada' },
        { status: 500 }
      )
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Explicit cleanup (service role) to guarantee full removal of related data
    // 1) Find songs owned by minister
    const { data: ministerSongs, error: songsFetchError } = await supabaseAdmin
      .from('songs')
      .select('id')
      .eq('minister_id', ministerId)

    if (songsFetchError) {
      console.error('Error fetching minister songs:', songsFetchError)
      return NextResponse.json(
        { error: `Erro ao buscar músicas do ministro: ${songsFetchError.message}` },
        { status: 400 }
      )
    }

    const songIds: string[] = []
    for (const song of (ministerSongs ?? []) as Array<{ id: string }>) {
      songIds.push(song.id)
    }

    // 2) Delete repertoire items directly assigned to minister
    const { error: repertoireByMinisterError } = await supabaseAdmin
      .from('repertoire')
      .delete()
      .eq('minister_id', ministerId)

    if (repertoireByMinisterError) {
      console.error('Error deleting repertoire by minister:', repertoireByMinisterError)
      return NextResponse.json(
        { error: `Erro ao excluir repertório do ministro: ${repertoireByMinisterError.message}` },
        { status: 400 }
      )
    }

    // 3) Delete repertoire items that reference songs owned by minister
    if (songIds.length > 0) {
      const { error: repertoireBySongsError } = await supabaseAdmin
        .from('repertoire')
        .delete()
        .in('song_id', songIds)

      if (repertoireBySongsError) {
        console.error('Error deleting repertoire by songs:', repertoireBySongsError)
        return NextResponse.json(
          { error: `Erro ao excluir itens de repertório vinculados às músicas: ${repertoireBySongsError.message}` },
          { status: 400 }
        )
      }
    }

    // 4) Delete songs owned by minister
    const { error: deleteSongsError } = await supabaseAdmin
      .from('songs')
      .delete()
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
