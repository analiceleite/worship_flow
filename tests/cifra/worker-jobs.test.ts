// @vitest-environment node
import { expect, test } from 'vitest'

const input = (jobId = 'one', ownerRef = 'owner') => ({ jobId, ownerRef, churchRef: 'church', canonicalUrl: 'https://www.cifraclub.com.br/a/b/', source: 'cifraclub' })
const result = { contract_version: 2, parser_version: '2', source: 'cifraclub', cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'B', artist: 'A', original_lines: ['G D'], original_tone: 'G', capo_frets: null, youtube_url: null, transposition_supported: true, warnings: [] }
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('replay_and_two_owners_share_extraction_but_not_private_tasks', async () => {
  const { createJobManager } = await import('../../services/cifraclub-importer/src/jobs.js')
  let calls = 0, finish: (value: unknown) => void = () => {}
  const manager = createJobManager({ extract: async () => { calls++; return new Promise((resolve) => { finish = resolve }) } })
  manager.create(input())
  manager.create(input())
  manager.create(input('two', 'other'))
  await tick()
  expect(calls).toBe(1)
  expect(() => manager.read('one', 'other')).toThrow('FORBIDDEN')
  expect(() => manager.create({ ...input(), canonicalUrl: 'https://www.cifraclub.com.br/a/c/' })).toThrow('IDEMPOTENCY_CONFLICT')
  manager.cancel('one', 'owner')
  finish(result); await tick()
  expect(manager.read('two', 'other').result).toEqual(result)
  expect(manager.read('one', 'owner').state).toBe('cancelled')
  await manager.close()
})

test('bounds_queue_deadline_and_terminal_retention', async () => {
  const { createJobManager } = await import('../../services/cifraclub-importer/src/jobs.js')
  let now = 0
  const manager = createJobManager({ now: () => now, extract: async () => new Promise(() => {}) })
  for (let i = 0; i < 4; i++) manager.create({ ...input(String(i)), canonicalUrl: `https://www.cifraclub.com.br/a/b${i}/` })
  expect(() => manager.create({ ...input('fifth'), canonicalUrl: 'https://www.cifraclub.com.br/a/fifth/' })).toThrow('CAPACITY')
  now = 30001; manager.sweep()
  expect(manager.read('0', 'owner').state).toBe('expired')
  now += 600001; manager.sweep()
  expect(() => manager.read('0', 'owner')).toThrow('JOB_EXPIRED')
  await manager.close()
})

test('public_cache_evicts_and_expires_without_negative_cache', async () => {
  const { createPublicCache } = await import('../../services/cifraclub-importer/src/cache.js')
  let now = 0
  const cache = createPublicCache({ maxEntries: 1, maxBytes: 10000, ttlMs: 10, now: () => now })
  cache.set('a', result); cache.set('b', result)
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('b')).toEqual(result)
  now = 11; expect(cache.get('b')).toBeUndefined()
})
