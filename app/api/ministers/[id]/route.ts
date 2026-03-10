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

    // Delete auth user (this will cascade delete minister record due to ON DELETE CASCADE)
    if (ministerToDelete.user_id) {
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(
        ministerToDelete.user_id
      )

      if (deleteAuthError) {
        console.error('Error deleting auth user:', deleteAuthError)
        return NextResponse.json(
          { error: `Erro ao excluir usuário: ${deleteAuthError.message}` },
          { status: 400 }
        )
      }
    } else {
      // If no user_id, just delete minister record directly
      const { error: deleteError } = await supabase
        .from('ministers')
        .delete()
        .eq('id', ministerId)

      if (deleteError) {
        console.error('Error deleting minister:', deleteError)
        return NextResponse.json(
          { error: `Erro ao excluir ministro: ${deleteError.message}` },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({
      message: 'Ministro excluído com sucesso. Todas as músicas e registros relacionados foram removidos.',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: `Erro inesperado: ${error.message}` },
      { status: 500 }
    )
  }
}
