import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ACCEPTED_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
  'text/csv',
])

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: minister, error: ministerError } = await supabase
    .from('ministers')
    .select('id, role')
    .eq('user_id', user.id)
    .single()

  if (ministerError || !minister || minister.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Arquivo nao enviado' }, { status: 400 })
  }

  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          'Formato invalido. Envie XLSX, XLS, CSV ou PDF.',
      },
      { status: 400 }
    )
  }

  const maxSizeInBytes = 20 * 1024 * 1024
  if (file.size > maxSizeInBytes) {
    return NextResponse.json({ error: 'Arquivo excede 20MB' }, { status: 400 })
  }

  const extension = file.name.includes('.')
    ? file.name.split('.').pop()!.toLowerCase()
    : 'bin'
  const sanitizedName = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''))
  const storagePath = `${Date.now()}-${sanitizedName}.${extension}`

  const adminSupabase = createAdminClient()
  const { error: uploadError } = await adminSupabase.storage
    .from('worship-schedules')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { error: insertError } = await adminSupabase.from('worship_schedules').insert({
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    uploaded_by: minister.id,
  })

  if (insertError) {
    await adminSupabase.storage.from('worship-schedules').remove([storagePath])
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 200 })
}
