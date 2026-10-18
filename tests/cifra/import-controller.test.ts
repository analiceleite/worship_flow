import { afterEach, expect, test, vi } from 'vitest'
const scope = { userId: 'user', churchId: 'church' }
const original = { contract_version: 2 as const, parser_version: '2', source: 'cifraclub' as const, cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'Importada', artist: 'Artista', original_lines: ['G D'], original_tone: 'G', capo_frets: null, youtube_url: null, transposition_supported: true, warnings: [] }
afterEach(() => vi.useRealTimers())

test('cold_start_90_seconds_survives_and_preserves_manual_fields', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const { createImportController } = await import('@/lib/cifra/import-controller')
  let created = 0
  const controller = createImportController({ transport: { ready: async () => Date.now() >= 90000, create: async () => { created++; return { jobId: 'a'.repeat(64), state: 'ready', deadlineAt: Date.now() + 30000, result: original } }, read: async () => { throw Error('unexpected') }, cancel: async () => {} } })
  const completion = controller.start({ url: original.cipher_url, title: 'Titulo revisado' }, scope)
  await vi.advanceTimersByTimeAsync(40000)
  expect(controller.getSnapshot().phase).toBe('starting')
  await vi.advanceTimersByTimeAsync(52000); await completion
  expect(controller.getSnapshot().phase).toBe('ready')
  expect(controller.getSnapshot().draft?.title).toBe('Titulo revisado')
  expect(created).toBe(1)
  controller.dispose()
})

test('awakening_expires_and_scope_change_prevents_stale_result', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const { createImportController } = await import('@/lib/cifra/import-controller')
  const controller = createImportController({ transport: { ready: async () => false, create: async () => { throw Error('unexpected') }, read: async () => { throw Error('unexpected') }, cancel: async () => {} } })
  const completion = controller.start({ url: original.cipher_url }, scope)
  await vi.advanceTimersByTimeAsync(122000); await completion
  expect(controller.getSnapshot().phase).toBe('failed')
  expect(controller.getSnapshot().error?.code).toBe('WAKE_TIMEOUT')
  controller.resetScope({ userId: 'user', churchId: 'other' })
  expect(controller.getSnapshot().draft).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  controller.dispose()
})

test('lost_creation_response_reuses_id_and_job_expiry_does_not_restart', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const { createImportController } = await import('@/lib/cifra/import-controller')
  const ids: string[] = []
  const controller = createImportController({ transport: {
    ready: async () => true,
    create: async (_url, id) => { ids.push(id); if (ids.length === 1) throw Object.assign(Error('UPSTREAM_TIMEOUT'), { code: 'UPSTREAM_TIMEOUT', status: 504 }); return { jobId: 'a'.repeat(64), state: 'extracting', deadlineAt: 30000 } },
    read: async () => { throw Object.assign(Error('JOB_EXPIRED'), { code: 'JOB_EXPIRED', status: 410 }) }, cancel: async () => {},
  } })
  const completion = controller.start({ url: original.cipher_url }, scope)
  await vi.advanceTimersByTimeAsync(6000); await completion
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1])
  expect(controller.getSnapshot().phase).toBe('expired')
  controller.dispose()
})
