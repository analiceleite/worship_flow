import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function GET() {
  try {
    const context = await getCurrentMinisterContext()
    const admin = createAdminClient()
    const { data: church } = await admin
      .from('churches')
      .select('id, name, slug, environment')
      .eq('id', context.churchId)
      .maybeSingle()

    return NextResponse.json({ context, church: church ?? null, features: { cifraImportV2: process.env.CIFRA_IMPORT_V2_ENABLED === 'true' } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
