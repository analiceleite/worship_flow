// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const db = vi.hoisted(() => ({ row: { id: 'song', minister_id: 'minister', church_id: 'church' } as Record<string, unknown> | null, written: null as Record<string, unknown> | null, filters: [] as string[], ministerChurch: 'church' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { db.filters.push(`${key}:${value}`); return query },
    update: (payload: Record<string, unknown>) => { db.written = payload; return query }, insert: (payload: Record<string, unknown>) => { db.written = payload; return query },
    maybeSingle: async () => ({ data: table === 'ministers' ? { id: 'minister', church_id: db.ministerChurch, is_active: true } : db.row, error: null }),
    single: async () => ({ data: { id: 'song' }, error: null }),
  }; return query
} }) }))
beforeEach(() => { db.written = null; db.filters = []; db.ministerChurch = 'church'; db.row = { id: 'song', minister_id: 'minister', church_id: 'church' } })
const original = { contract_version: 2 as const, parser_version: '2', source: 'cifraclub' as const, cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'N', artist: 'A', original_lines: ['C/E', 'Uma letra'], original_tone: 'C', capo_frets: 0, youtube_url: null, transposition_supported: true, warnings: [] }
const input = { title: 'N', artist: 'A', tone: 'D', youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', original }
const context = { userId: 'user', churchId: 'church', ministerId: 'minister', role: 'minister' as const, isAdmin: false }

test('server_recomputes_selected_lines_and_scopes_update', async () => {
  const { saveImportedSong } = await import('@/lib/cifra/save-song')
  await saveImportedSong(input, context, 'song')
  expect(db.written?.cifra_content).toEqual(['D/F#', 'Uma letra'])
  expect(db.written?.cifra_original).toEqual(original)
  expect(db.filters).toContain('church_id:church')
  expect(db.filters).toContain('minister_id:minister')
})
test('missing_record_and_changed_owner_do_not_report_success', async () => {
  const { saveImportedSong } = await import('@/lib/cifra/save-song')
  db.row = null
  await expect(saveImportedSong(input, context, 'song')).rejects.toMatchObject({ status: 404 })
  db.row = { id: 'song', minister_id: 'other', church_id: 'church' }
  await expect(saveImportedSong(input, context, 'song')).rejects.toMatchObject({ status: 403 })
  expect(db.written).toBeNull()
})
test('unknown_capo_requires_confirmation_and_foreign_minister_is_rejected', async () => {
  const { saveImportedSong } = await import('@/lib/cifra/save-song')
  await expect(saveImportedSong({ ...input, original: { ...original, capo_frets: null } }, context)).rejects.toMatchObject({ status: 422 })
  db.ministerChurch = 'other'
  await expect(saveImportedSong(input, context)).rejects.toMatchObject({ status: 403 })
})
