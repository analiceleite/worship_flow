// WF-38 / WF-26 pure rules: public signup input, church input, error mapping and first steps.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  churchCreateSchema,
  churchCreationHttpError,
  firstSteps,
  publicSignupSchema,
} from '../lib/onboarding/rules.ts'

test('public signup accepts a normalized owner and rejects extra fields', () => {
  const ok = publicSignupSchema.safeParse({ name: '  Ana ', email: ' ANA@Example.com ', password: '12345678' })
  assert.equal(ok.success, true)
  if (ok.success) {
    assert.equal(ok.data.name, 'Ana')
    assert.equal(ok.data.email, 'ana@example.com')
  }
  assert.equal(publicSignupSchema.safeParse({ name: 'Ana', email: 'ana@example.com', password: '1234567' }).success, false)
  assert.equal(publicSignupSchema.safeParse({ name: 'Ana', email: 'ana@example.com', password: '12345678', role: 'admin' }).success, false)
})

test('church input requires a name and a client idempotency key, and nothing else', () => {
  const key = '6f1c2a4e-8b7d-4c3a-9e2f-1a2b3c4d5e6f'
  assert.equal(churchCreateSchema.safeParse({ name: 'Igreja Esperança', idempotencyKey: key }).success, true)
  assert.equal(churchCreateSchema.safeParse({ name: 'I', idempotencyKey: key }).success, false)
  assert.equal(churchCreateSchema.safeParse({ name: 'Igreja', idempotencyKey: 'não-é-uuid' }).success, false)
  assert.equal(churchCreateSchema.safeParse({ name: 'Igreja', idempotencyKey: key, plan: 'pro' }).success, false)
})

test('quota and verification errors map to explicit statuses without leaking internals', () => {
  assert.equal(churchCreationHttpError('EMAIL_NOT_VERIFIED').status, 403)
  assert.equal(churchCreationHttpError('QUOTA_EXCEEDED').status, 409)
  assert.match(churchCreationHttpError('QUOTA_EXCEEDED').message, /suporte/)
  assert.equal(churchCreationHttpError('IDEMPOTENCY_CONFLICT').status, 409)
  assert.equal(churchCreationHttpError('INVALID_INPUT').status, 400)
  const unknown = churchCreationHttpError('UNKNOWN')
  assert.equal(unknown.status, 503)
  assert.doesNotMatch(unknown.message, /supabase|postgres|WF38/i)
})

test('first steps are derived from real data and never all done for a new church', () => {
  const fresh = firstSteps({ activeMembers: 1, songs: 0, quarters: 0 })
  assert.deepEqual(fresh.map(step => step.done), [false, false, false])

  const team = firstSteps({ activeMembers: 2, songs: 0, quarters: 0 })
  assert.deepEqual(team.map(step => step.done), [true, false, false])

  const done = firstSteps({ activeMembers: 3, songs: 5, quarters: 1 })
  assert.equal(done.every(step => step.done), true)
})
