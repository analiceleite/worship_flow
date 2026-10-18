// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'

const context = vi.hoisted(() => ({ userId: 'user-a', churchId: 'church-a', ministerId: 'minister-a', role: 'admin', isAdmin: true, isImpersonating: false }))
vi.mock('@/lib/auth-context', () => ({ getCurrentMinisterContext: async () => ({ ...context }), AuthContextError: class extends Error { status = 403 } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'churches' ? { status: 'active' } : { is_active: true, instrument: 'Voz', church_id: context.churchId } }) }) }) }) }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

test('owner_binding_is_stable_and_changes_with_effective_church', async () => {
  vi.stubEnv('CIFRACLUB_IMPORTER_TOKEN', 'test-only-internal-token')
  const { deriveOwner, deriveJobId } = await import('@/lib/cifra/job-owner')
  const first = deriveOwner(context)
  expect(first.ownerRef).toHaveLength(64)
  expect(deriveOwner({ ...context }).ownerRef).toBe(first.ownerRef)
  expect(deriveOwner({ ...context, churchId: 'church-b' }).ownerRef).not.toBe(first.ownerRef)
  expect(deriveJobId(first.ownerRef, 'nonce')).toBe(deriveJobId(first.ownerRef, 'nonce'))
})

test('create_route_does_not_trust_client_owner_and_rejects_foreign_origin', async () => {
  vi.stubEnv('CIFRA_IMPORT_V2_ENABLED', 'true')
  vi.stubEnv('CIFRACLUB_IMPORTER_TOKEN', 'test-only-internal-token')
  vi.stubEnv('CIFRACLUB_IMPORTER_URL', 'https://worker.example')
  const { POST } = await import('@/app/api/cifra/jobs/route')
  const bad = await POST(new Request('https://app.example/api/cifra/jobs', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }))
  expect(bad.status).toBe(403)
  let workerRequest: RequestInit | undefined
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    workerRequest = options
    const { jobId } = JSON.parse(options.body as string)
    return new Response(JSON.stringify({ jobId, state: 'queued', deadlineAt: Date.now() + 30000 }), { status: 202 })
  })
  const good = await POST(new Request('https://app.example/api/cifra/jobs', { method: 'POST', headers: { origin: 'https://app.example' }, body: JSON.stringify({ url: 'https://www.cifraclub.com.br/a/b/', requestId: '7a365a70-182b-4339-84a2-5c66401edc28' }) }))
  expect(good.status).toBe(202)
  const publicBody = await good.text()
  expect(publicBody).not.toContain('test-only-internal-token')
  expect(publicBody).not.toContain('ownerRef')
  expect(new Headers(workerRequest?.headers).get('x-cifra-owner')).toHaveLength(64)
})
