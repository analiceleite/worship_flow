import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'
import { getImpersonatedChurchId } from '@/lib/auth-context'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { createAdminClient } from '@/lib/supabase/admin'
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, avatarExtension } from '@/lib/profile-avatar'

export const runtime = 'nodejs'

async function updateAvatar(request: Request, remove: boolean) {
  try {
    const user = await getAuthenticatedIdentity()
    if (!user) {
      return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 })
    }
    if (await getImpersonatedChurchId()) {
      return NextResponse.json({ error: 'Encerre o contexto de suporte para alterar seu perfil pessoal.' }, { status: 403 })
    }
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { data: profile, error: readError } = await admin.from('user_profiles')
      .select('avatar_url').eq('user_id', user.id).single()
    if (readError || !profile) {
      return NextResponse.json({ error: 'Não foi possível localizar seu perfil.' }, { status: 403 })
    }

    const bucket = admin.storage.from(AVATAR_BUCKET)
    const prefix = `${user.id}/`
    let newPath: string | null = null
    let avatarUrl: string | null = null

    if (!remove) {
      if (Number(request.headers.get('content-length')) > AVATAR_MAX_BYTES + 64 * 1024) {
        return NextResponse.json({ error: 'A foto deve ter no máximo 2 MB.' }, { status: 413 })
      }
      let form: FormData
      try {
        form = await request.formData()
      } catch {
        return NextResponse.json({ error: 'Envie uma foto em JPG, PNG ou WebP.' }, { status: 400 })
      }
      const file = form.get('photo')
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: 'Selecione uma foto.' }, { status: 400 })
      }
      if (file.size > AVATAR_MAX_BYTES) {
        return NextResponse.json({ error: 'A foto deve ter no máximo 2 MB.' }, { status: 413 })
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const extension = avatarExtension(file.type, bytes)
      if (!extension) {
        return NextResponse.json({ error: 'Formato inválido. Use uma foto JPG, PNG ou WebP.' }, { status: 400 })
      }
      newPath = `${prefix}${randomUUID()}.${extension}`
      const { error: uploadError } = await bucket.upload(newPath, bytes, { contentType: file.type, upsert: false })
      if (uploadError) {
        console.error('Erro ao armazenar foto de perfil:', uploadError)
        return NextResponse.json({ error: 'Não foi possível enviar a foto. Tente novamente.' }, { status: 500 })
      }
      avatarUrl = bucket.getPublicUrl(newPath).data.publicUrl
    }

    const { error: updateError } = await admin.from('user_profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('user_id', user.id).select('user_id').single()
    if (updateError) {
      if (newPath) await bucket.remove([newPath])
      return NextResponse.json({ error: 'Não foi possível salvar sua foto. Tente novamente.' }, { status: 500 })
    }

    // Never delete an arbitrary URL or an object belonging to a different user.
    const publicPrefix = bucket.getPublicUrl(prefix).data.publicUrl
    // Legacy church-scoped objects are retained until a dedicated cleanup.
    if (profile.avatar_url?.startsWith(publicPrefix)) {
      const filename = profile.avatar_url.slice(publicPrefix.length)
      if (/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
        const { error } = await bucket.remove([`${prefix}${filename}`])
        if (error) console.error('Erro ao remover foto antiga:', error)
      }
    }

    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (error) {
    console.error('Erro ao atualizar foto de perfil:', error)
    return NextResponse.json({ error: 'Não foi possível atualizar sua foto.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return updateAvatar(request, false)
}

export async function DELETE(request: Request) {
  return updateAvatar(request, true)
}
