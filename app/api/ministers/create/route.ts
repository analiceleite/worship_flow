import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { email, name, instrument, role } = await request.json()

    // Validate input
    if (!email || !name || !instrument) {
      return NextResponse.json(
        { error: 'Email, nome e instrumento são obrigatórios' },
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
        { error: 'Apenas administradores podem criar ministros' },
        { status: 403 }
      )
    }

    // Create admin client with service role key
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Service Role Key não configurada. Adicione SUPABASE_SERVICE_ROLE_KEY no .env.local' },
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

    const { data: ministerData, error: ministerError } = await supabase
      .from('ministers')
      .insert({
        name,
        email,
        instrument,
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
