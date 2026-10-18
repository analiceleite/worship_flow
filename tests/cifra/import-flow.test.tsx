import { afterEach, expect, test, vi } from 'vitest'
import { createImportController } from '@/lib/cifra/import-controller'
import { saveImportedSong } from '@/lib/cifra/save-song'

const scope = { userId: 'user-a', churchId: 'church-a' }
const original = { contract_version: 2 as const, parser_version: '2', source: 'cifraclub' as const, cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'Musica', artist: 'Artista', original_lines: ['G   D', 'Uma letra'], original_tone: 'G', capo_frets: 0, youtube_url: null, transposition_supported: true, warnings: [] }
let savedPayload: any = { value: null }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function mockSupabase() {
  return {
    from: (table: string) => {
      const base = {
        select: () => base,
        eq: (_key: string, _value: unknown) => base,
        maybeSingle: async () => {
          if (table === 'churches') return { data: { status: 'active' }, error: null }
          if (table === 'songs') return { data: { id: 'song-x', minister_id: 'minister-a', church_id: 'church-a' }, error: null }
          return { data: { id: 'minister-a', church_id: 'church-a', is_active: true, instrument: 'Voz' }, error: null }
        },
      }
      return {
        ...base,
        update: (payload: any) => {
          savedPayload.value = { ...payload }
          return {
            eq: (_key: string, _value: unknown) => ({
              eq: (_key2: string, _value2: unknown) => ({
                eq: (_key3: string, _value3: unknown) => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: 'song-x' } }),
                  }),
                }),
              }),
            }),
          }
        },
        insert: (payload: any) => {
          savedPayload.value = { ...payload }
          return {
            select: () => ({
              single: async () => ({ data: { id: 'song-x' } }),
            }),
          }
        },
      }
    },
  }
}

test('fluxo_completo_despertar_retry_nova_tela_transposicao_sem_salvar_sem_confirmacao', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  vi.stubEnv('CIFRACLUB_IMPORTER_TOKEN', 'test-only-internal-token')
  let wakeCalls = 0, createCalls: string[] = []
  let serviceReady = false
  vi.mock('@/lib/auth-context', () => ({ getCurrentMinisterContext: async () => ({ ...scope, ministerId: 'minister-a', role: 'minister', isAdmin: false }), AuthContextError: class extends Error { status = 403 } }))
  vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mockSupabase() }))
  const controller = createImportController({ transport: {
    ready: async () => { wakeCalls++; return serviceReady },
    create: async (_url, id) => { createCalls.push(id); await new Promise(r => setTimeout(r, 100)); return { jobId: id, state: 'ready', deadlineAt: 30000, result: original } },
    read: async () => { return { jobId: 'a'.repeat(64), state: 'ready', deadlineAt: 30000, result: original } },
    cancel: async () => {},
  } })

  const startPromise = controller.start({ url: original.cipher_url, title: 'Musica revisada' }, scope)
  await vi.advanceTimersByTimeAsync(90000)
  expect(controller.getSnapshot().phase).toBe('starting')
  serviceReady = true
  await vi.advanceTimersByTimeAsync(5000)
  await startPromise
  expect(controller.getSnapshot().phase).toBe('ready')
  expect(createCalls).toHaveLength(1)

  const draft = controller.getSnapshot().draft!
  expect(draft.title).toBe('Musica revisada')
  expect(draft.original).toEqual(original)

  controller.updateDraft({ tone: 'D' })
  expect(controller.getSnapshot().draft?.tone).toBe('D')
  expect(createCalls).toHaveLength(1)

  controller.cancel()
  expect(controller.getSnapshot().phase).toBe('cancelled')
  controller.dispose()
})

test('resposta_de_criacao_perdida_reusa_mesmo_jobId_e_nao_duplica_extracao', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const calls: string[] = []
  const controller = createImportController({ transport: {
    ready: async () => true,
    create: async (_url, id) => { calls.push(id); if (calls.length === 1) throw Object.assign(Error('UPSTREAM_TIMEOUT'), { code: 'UPSTREAM_TIMEOUT', status: 504 }); return { jobId: 'b'.repeat(64), state: 'queued', deadlineAt: 30000 } },
    read: async () => { throw Object.assign(Error('JOB_EXPIRED'), { code: 'JOB_EXPIRED', status: 410 }) },
    cancel: async () => {},
  } })
  const completion = controller.start({ url: original.cipher_url }, scope)
  await vi.advanceTimersByTimeAsync(6000)
  await completion
  expect(calls).toHaveLength(2)
  expect(calls[0]).toBe(calls[1])
  expect(controller.getSnapshot().phase).toBe('expired')
  controller.dispose()
})

test('salvo_somente_apos_confirmacao_e_nao_grava_antes', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  vi.stubEnv('CIFRACLUB_IMPORTER_TOKEN', 'test-only-internal-token')
  vi.mock('@/lib/auth-context', () => ({ getCurrentMinisterContext: async () => ({ ...scope, ministerId: 'minister-a', role: 'minister', isAdmin: false }), AuthContextError: class extends Error { status = 403 } }))
  vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mockSupabase() }))
  const input = { title: 'N', artist: 'A', tone: 'D', youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', original }
  await saveImportedSong(input, { ...scope, ministerId: 'minister-a', role: 'minister', isAdmin: false }, 'song-x')
  expect(savedPayload.value.cifra_content).toEqual(['D   A', 'Uma letra'])
  expect(savedPayload.value.cifra_original).toEqual(original)
  expect(savedPayload.value.cifra_content).not.toEqual(original.original_lines)
})
