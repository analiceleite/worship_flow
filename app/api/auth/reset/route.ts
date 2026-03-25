import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ResetPayload = {
  token?: string
  password?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResetPayload
    const { token, password } = body

    if (!token || !password) {
      return NextResponse.json({ error: 'Token e nova senha são obrigatórios.' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    // Busca token
    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from('password_resets')
      .select('*')
      .eq('token', token)
      .single()

    if (tokenError || !tokenRow) {
      return NextResponse.json({ error: 'Token inválido ou expirado.' }, { status: 400 })
    }

    if (tokenRow.used) {
      return NextResponse.json({ error: 'Token já utilizado.' }, { status: 400 })
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token expirado.' }, { status: 400 })
    }

    const userId = tokenRow.user_id

    if (!userId) {
      // Se não temos user_id, tentamos localizar pelo email
      const { data: usersRes } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 })
      const users = (usersRes as any)?.data?.users || (usersRes as any)?.users || []
      const found = users.find((u: any) => u.email?.toLowerCase() === tokenRow.email)
      if (found) {
        // @ts-ignore
        tokenRow.user_id = found.id
      }
    }

    if (!tokenRow.user_id) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 400 })
    }

    // Atualiza senha via admin API
    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      tokenRow.user_id,
      { password }
    )

    if (updateError) {
      console.error('updateUser error', updateError)
      return NextResponse.json({ error: 'Erro ao atualizar senha.' }, { status: 500 })
    }

    // Marca token como usado
    await supabaseAdmin
      .from('password_resets')
      .update({ used: true })
      .eq('token', token)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('reset error', err)
    return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 })
  }
}
