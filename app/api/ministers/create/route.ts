import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function POST(request: Request) {
  try {
    const { email, name, instrument, role } = await request.json()

    // Validate input
    if (!email || !name) {
      return NextResponse.json(
        { error: 'Email e nome são obrigatórios' },
        { status: 400 }
      )
    }

    if (role !== 'midia' && !instrument) {
      return NextResponse.json(
        { error: 'Instrumento é obrigatório para ministros e administradores' },
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

    // Generate temporary password
    const temporaryPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8)

    // Create auth user with admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        name,
      },
    })

    if (authError) {
      console.error('Auth error:', authError)
      return NextResponse.json(
        { error: `Erro ao criar usuário: ${authError.message}` },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Erro ao criar usuário' },
        { status: 500 }
      )
    }

    // Create minister record
    const ministerRole = role === 'admin' ? 'admin' : role === 'midia' ? 'midia' : 'minister'

    const { data: ministerData, error: ministerError } = await supabaseAdmin
      .from('ministers')
      .insert({
        church_id: context.churchId,
        name,
        email,
        instrument: ministerRole === 'midia' ? 'Midia' : instrument,
        user_id: authData.user.id,
        role: ministerRole,
        is_active: false,
      })
      .select()
      .single()

    if (ministerError) {
      console.error('Minister error:', ministerError)
      // Try to delete the auth user if minister creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: `Erro ao criar ministro: ${ministerError.message}` },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data: ministerData,
      temporaryPassword,
      message: 'Ministro criado com sucesso',
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: `Erro inesperado: ${error.message}` },
      { status: 500 }
    )
  }
}
