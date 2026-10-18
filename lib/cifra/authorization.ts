import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasLeadVoiceRole } from '@/lib/permissions'

export async function requireSongImportContext() {
  const context = await getCurrentMinisterContext()
  const admin = createAdminClient()
  const { data: church, error: churchError } = await admin.from('churches').select('status').eq('id', context.churchId).maybeSingle()
  if (churchError || church?.status !== 'active') throw new AuthContextError('Igreja indisponível.', 403)
  if (!context.isImpersonating) {
    const { data: minister, error } = await admin.from('ministers').select('is_active, instrument, church_id').eq('id', context.ministerId).maybeSingle()
    if (error || !minister?.is_active || minister.church_id !== context.churchId || (!context.isAdmin && (context.role !== 'minister' || !hasLeadVoiceRole(minister.instrument)))) throw new AuthContextError('Sem permissão para gerenciar músicas.', 403)
  }
  return context
}
