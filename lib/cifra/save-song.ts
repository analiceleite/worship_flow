import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CurrentMinisterContext } from '@/lib/types'
import { OriginalCifraSchema } from './contract'
import { transposeOriginal } from './transpose'
import { toneOptions } from './tone'
import { ImportServiceError } from './service-client'

const youtube = z.string().url().max(2048).refine((value) => { const url = new URL(value); return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname) && !url.username && !url.password })
export const SaveImportedSongSchema = z.object({
  title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300), tone: z.string().max(4),
  youtube_url: youtube, youtube_video_title: z.string().max(500).nullable().optional(), original: OriginalCifraSchema,
  confirmedOriginalTone: z.string().max(4).optional(), confirmedCapoFrets: z.number().int().min(0).max(12).optional(), ministerId: z.string().optional(),
}).strict()
export type SaveImportedSongInput = z.infer<typeof SaveImportedSongSchema>
export async function saveImportedSong(raw: SaveImportedSongInput, context: CurrentMinisterContext, songId?: string): Promise<{ id: string }> {
  const input = SaveImportedSongSchema.parse(raw)
  const admin = createAdminClient()
  let ministerId = context.isImpersonating ? input.ministerId : context.isAdmin ? input.ministerId || context.ministerId : context.ministerId
  if (songId) {
    const { data: existing, error } = await admin.from('songs').select('id,minister_id,church_id').eq('id', songId).eq('church_id', context.churchId).maybeSingle()
    if (error) throw new ImportServiceError('SAVE_FAILED', 502)
    if (!existing) throw new ImportServiceError('NOT_FOUND', 404)
    if (!context.isAdmin && existing.minister_id !== context.ministerId) throw new ImportServiceError('FORBIDDEN', 403)
    ministerId = existing.minister_id
  }
  if (!ministerId) throw new ImportServiceError('SELECT_MINISTER', 422)
  const { data: minister, error: ministerError } = await admin.from('ministers').select('id,church_id,is_active').eq('id', ministerId).eq('church_id', context.churchId).maybeSingle()
  if (ministerError || !minister?.is_active || minister.church_id !== context.churchId) throw new ImportServiceError('FORBIDDEN', 403)
  if (input.original.original_tone === null && !input.confirmedOriginalTone) throw new ImportServiceError('CONFIRM_TONE', 422)
  if (input.original.capo_frets === null && input.confirmedCapoFrets === undefined) throw new ImportServiceError('CONFIRM_CAPO', 422)
  const original = OriginalCifraSchema.parse({ ...input.original,
    original_tone: input.original.original_tone ?? input.confirmedOriginalTone,
    capo_frets: input.original.capo_frets ?? input.confirmedCapoFrets,
    warnings: [...input.original.warnings, ...(input.original.original_tone === null ? ['USER_CONFIRMED_TONE'] : []), ...(input.original.capo_frets === null ? ['USER_CONFIRMED_CAPO'] : [])],
  })
  let selected
  try { selected = transposeOriginal(original, input.tone) } catch { throw new ImportServiceError('INVALID_TRANSPOSE', 422) }
  const payload = { title: input.title, artist: input.artist, tone: selected.tone, youtube_url: input.youtube_url, youtube_video_title: input.youtube_video_title || null, cifra_original: original, cifra_content: selected.lines, cipher_url: original.cipher_url, capo_frets: original.capo_frets, available_tones: original.transposition_supported ? toneOptions(selected.tone) : [selected.tone] }
  if (songId) {
    let query = admin.from('songs').update(payload).eq('id', songId).eq('church_id', context.churchId).eq('minister_id', ministerId)
    const { data, error } = await query.select('id').maybeSingle()
    if (error) throw new ImportServiceError('SAVE_FAILED', 502)
    if (!data) throw new ImportServiceError('RECORD_CHANGED', 409)
    return { id: data.id }
  }
  const { data, error } = await admin.from('songs').insert({ ...payload, church_id: context.churchId, minister_id: ministerId }).select('id').single()
  if (error || !data) throw new ImportServiceError('SAVE_FAILED', 502)
  return { id: data.id }
}
