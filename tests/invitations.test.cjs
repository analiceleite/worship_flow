const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function load(relative) {
  const filename = path.resolve(__dirname, '..', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports)
  return module.exports
}

process.env.INVITATION_TOKEN_SECRET = 'unit-test-secret-not-used-anywhere-else'
const crypto = load('lib/invitations/crypto.ts')
const email = load('lib/invitations/email.ts')
const errors = load('lib/invitations/errors.ts')

test('tokens are random, hashed deterministically and never equal the hash', () => {
  const a = crypto.createInvitationToken()
  const b = crypto.createInvitationToken()
  assert.notEqual(a, b)
  assert.ok(a.length >= 40 && /^[A-Za-z0-9_-]+$/.test(a))
  const hash = crypto.hashInvitationToken(a)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(crypto.hashInvitationToken(a), hash)
  assert.notEqual(hash, a)
})

test('outbox ciphertext round-trips and rejects tampering', () => {
  const token = crypto.createInvitationToken()
  const sealed = crypto.encryptInvitationToken(token)
  assert.ok(!sealed.includes(token))
  assert.equal(crypto.decryptInvitationToken(sealed), token)
  const bytes = Buffer.from(sealed, 'base64url')
  bytes[bytes.length - 1] ^= 0x01
  assert.throws(() => crypto.decryptInvitationToken(bytes.toString('base64url')))
})

test('rate-limit keys are scoped and do not expose the subject', () => {
  const key = crypto.invitationRateLimitKey('create', 'church:someone@example.com')
  assert.match(key, /^[0-9a-f]{64}$/)
  assert.notEqual(key, crypto.invitationRateLimitKey('resend', 'church:someone@example.com'))
  assert.ok(!key.includes('someone'))
})

test('invitation origin accepts only bare http(s) origins; production forbids http', () => {
  assert.equal(email.invitationOrigin('http://127.0.0.1:3001', false), 'http://127.0.0.1:3001')
  assert.equal(email.invitationOrigin('https://app.example.com', true), 'https://app.example.com')
  assert.throws(() => email.invitationOrigin('http://app.example.com', true))
  assert.throws(() => email.invitationOrigin('https://app.example.com/path', true))
  assert.throws(() => email.invitationOrigin('https://user:pass@app.example.com', true))
  assert.throws(() => email.invitationOrigin('https://app.example.com?x=1', true))
  assert.throws(() => email.invitationOrigin(undefined, false))
})

test('local e-mail capture refuses production and non-local stacks', () => {
  const origin = 'http://127.0.0.1:3001'
  assert.equal(email.localInvitationMail(true, false, origin, 'http://127.0.0.1:54321'), true)
  assert.equal(email.localInvitationMail(false, false, 'https://app.example.com', 'https://x.supabase.co'), false)
  assert.throws(() => email.localInvitationMail(true, true, origin, 'http://127.0.0.1:54321'))
  assert.throws(() => email.localInvitationMail(true, false, origin, 'https://x.supabase.co'))
})

test('invitation URL carries only the encoded token in the path', () => {
  const url = email.invitationUrl('http://127.0.0.1:3001', 'abc_-DEF')
  assert.equal(url, 'http://127.0.0.1:3001/auth/invite/abc_-DEF')
  assert.equal(email.invitationUrl('http://127.0.0.1:3001', 'a/b?c').includes('?'), false)
})

test('errors map to safe, specific HTTP responses without leaking internals', () => {
  assert.deepEqual(errors.invitationError(new Error('WF04_FORBIDDEN raised')).status, 403)
  assert.equal(errors.invitationError(new Error('WF04_INVITATION_EXPIRED')).status, 410)
  assert.equal(errors.invitationError(new Error('duplicate key value violates unique constraint 23505')).status, 409)
  const unknown = errors.invitationError(new Error('connection to db.internal:5432 refused'))
  assert.equal(unknown.status, 503)
  assert.ok(!unknown.message.includes('db.internal'))
})

test('invitation e-mail escapes church and person names', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../lib/invitations/email.ts'), 'utf8')
  assert.match(source, /escapeHtml\(input\.churchName\)/)
  assert.match(source, /escapeHtml\(input\.inviteUrl\)/)
})

test('invitation state machine is evaluated by the server clock', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../lib/invitations/server.ts'), 'utf8')
  assert.match(server, /export function invitationState\(/)
  assert.match(server, /Date\.parse\(row\.expires_at\) <= now/)
  assert.match(server, /MAX_DELIVERY_ATTEMPTS/)
})

test('legacy temporary-password creation stays retired', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../app/api/ministers/create/route.ts'), 'utf8')
  assert.match(route, /status: 410/)
  assert.ok(!/temporaryPassword|createUser|generatePassword/.test(route))
  const form = fs.readFileSync(path.resolve(__dirname, '../components/minister-form.tsx'), 'utf8')
  assert.ok(!/temporaryPassword|ministers\/create/.test(form))
})
