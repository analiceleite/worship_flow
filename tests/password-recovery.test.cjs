const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

// Use the existing TypeScript compiler; no extra test framework or network calls.
function loadTypeScript(relativePath, mocks = {}, envOverrides = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const requireMock = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id === '@/lib/supabase/server-fetch') return { serverSupabaseFetch: () => assert.fail('Unexpected Supabase network call in a unit test') }
    return localRequire(id)
  }
  const processMock = { env: {
    APP_BASE_URL: 'https://worship.example.com', NODE_ENV: 'test',
    NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.com', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', RESEND_API_KEY: 'test-mail-key', RESEND_FROM_EMAIL: 'no-reply@example.com',
    ...envOverrides,
  } }
  new Function('require', 'module', 'exports', 'process', 'fetch', outputText)(requireMock, module, module.exports, processMock,
    mocks.fetch || (() => assert.fail('Unexpected network call in a unit test')))
  return module.exports
}

const core = loadTypeScript('lib/auth/password-recovery.ts')
const tokenHash = 'a'.repeat(64)
const email = 'person@example.com'
const password = 'test-password-123'

function dependencies(overrides = {}) {
  const calls = []
  return {
    calls,
    origin: 'https://worship.example.com',
    allow: async (...args) => { calls.push(['allow', ...args]); return true },
    generate: async (value) => { calls.push(['generate', value]); return tokenHash },
    send: async (...args) => { calls.push(['send', ...args]) },
    report: (event) => { calls.push(['report', event]) },
    ...overrides,
  }
}

test('configured origin is canonical and independent from request headers', () => {
  assert.equal(core.recoveryOrigin('https://worship.example.com/', true), 'https://worship.example.com')
  assert.equal(core.recoveryOrigin('http://localhost:3000', false), 'http://localhost:3000')
  for (const value of [undefined, '', 'invalid', 'http://worship.example.com', 'https://user:pass@worship.example.com',
    'https://worship.example.com/path', 'https://worship.example.com/?next=evil', 'https://worship.example.com/#fragment']) {
    assert.throws(() => core.recoveryOrigin(value, true))
  }
  assert.throws(() => core.recoveryOrigin('http://localhost:3000', true))
  assert.throws(() => core.recoveryOrigin('http://other.example.com', false))
})

test('local mail capture cannot be enabled against production or non-local destinations', () => {
  assert.equal(core.localRecoveryMail(false, true, 'https://worship.example.com', 'https://auth.example.com'), false)
  assert.equal(core.localRecoveryMail(true, false, 'http://127.0.0.1:3001', 'http://127.0.0.1:54321'), true)
  assert.throws(() => core.localRecoveryMail(true, true, 'http://127.0.0.1:3001', 'http://127.0.0.1:54321'))
  assert.throws(() => core.localRecoveryMail(true, false, 'http://127.0.0.1:3001', 'https://auth.example.com'))
  assert.throws(() => core.localRecoveryMail(true, false, 'https://worship.example.com', 'http://127.0.0.1:54321'))
  assert.throws(() => core.localRecoveryMail(true, false, 'http://127.0.0.1:3001', 'http://127.0.0.1:54321/?target=production'))
})

test('local transport sends only to loopback Mailpit and never instantiates Resend', async () => {
  const calls = []
  const implementation = loadTypeScript('lib/auth/password-recovery-server.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => ({}) },
    './password-recovery': core,
    resend: { Resend: class { constructor() { assert.fail('Local development must not instantiate Resend') } } },
    fetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true } },
  }, { LOCAL_SUPABASE: 'true', APP_BASE_URL: 'http://127.0.0.1:3001', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' })
  await implementation.recoveryDependencies().send(email, 'http://127.0.0.1:3001/auth/reset')
  assert.equal(calls[0][0], 'http://127.0.0.1:54324/api/v1/send')
  assert.equal(calls[0][1].To[0].Email, email)
})

test('valid email is normalized; only the email channel receives recovery proof', async () => {
  const deps = dependencies()
  const result = await core.requestPasswordRecovery({ email: ' Person@Example.com ' }, deps)
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.ok(!JSON.stringify(result).includes(tokenHash))
  assert.ok(!Object.hasOwn(result.body, 'resetUrl'))
  assert.deepEqual(deps.calls.slice(0, 3), [
    ['allow', 'request-global', 'all', 100], ['allow', 'request-email', email, 3], ['generate', email],
  ])
  const delivery = deps.calls.find(([kind]) => kind === 'send')
  const url = new URL(delivery[2])
  assert.equal(delivery[1], email)
  assert.equal(url.origin, deps.origin)
  assert.equal(url.pathname, '/auth/reset')
  assert.equal(url.search, '')
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token_hash'), tokenHash)
})

test('unknown account, suppressed request and delivery failure have identical public responses', async () => {
  const successful = await core.requestPasswordRecovery({ email }, dependencies())
  const missing = dependencies({ generate: async () => null })
  const suppressed = dependencies({ allow: async () => false })
  const failed = dependencies({ send: async () => { throw new Error('sensitive-provider-details') } })
  for (const deps of [missing, suppressed, failed]) {
    assert.deepEqual(await core.requestPasswordRecovery({ email }, deps), successful)
  }
  assert.ok(!missing.calls.some(([kind]) => kind === 'send'))
  assert.equal(suppressed.calls.length, 0)
  assert.deepEqual(failed.calls.at(-1), ['report', 'delivery_failed'])
})

test('recipient suppression never generates another link', async () => {
  const deps = dependencies({ allow: async (scope) => scope === 'request-global' })
  assert.equal((await core.requestPasswordRecovery({ email }, deps)).status, 200)
  assert.ok(!deps.calls.some(([kind]) => kind === 'generate'))
})

test('malformed input and additional fields are rejected before any side effect', async () => {
  for (const payload of [null, {}, [], { email: 'invalid' }, { email: 42 }, { email, redirectTo: 'https://evil.example' }]) {
    const deps = dependencies()
    assert.equal((await core.requestPasswordRecovery(payload, deps)).status, 400)
    assert.equal(deps.calls.length, 0)
  }
})

test('limiter or token service failure fails closed without returning provider details', async () => {
  for (const override of [
    { allow: async () => { throw new Error('private database details') } },
    { generate: async () => { throw new Error('private auth details') } },
  ]) {
    const deps = dependencies(override)
    const result = await core.requestPasswordRecovery({ email }, deps)
    assert.equal(result.status, 503)
    assert.ok(!JSON.stringify(result).includes('private'))
    assert.ok(!deps.calls.some(([kind]) => kind === 'send'))
  }
})

test('legacy token payloads, missing proof and invalid passwords cannot reach Auth', async () => {
  for (const payload of [null, { password }, { token: tokenHash, password }, { tokenHash: 'invalid', password },
    { tokenHash, password: '12345' }, { tokenHash, password: 'x'.repeat(129) }, { tokenHash, password, userId: 'someone-else' }]) {
    let calls = 0
    const result = await core.resetPassword(payload, {
      allow: async () => { calls++; return true }, verifyAndUpdate: async () => { calls++; return 'success' },
    })
    assert.equal(result.status, 400)
    assert.equal(calls, 0)
  }
})

test('reset is rate limited before verifying proof', async () => {
  let verified = false
  const result = await core.resetPassword({ tokenHash, password }, {
    allow: async () => false, verifyAndUpdate: async () => { verified = true; return 'success' },
  })
  assert.equal(result.status, 429)
  assert.equal(verified, false)
})

test('reset outcomes do not expose credentials or internal details', async () => {
  for (const [outcome, status] of [['success', 200], ['invalid', 400], ['password_rejected', 400], ['unavailable', 503]]) {
    const result = await core.resetPassword({ tokenHash, password }, {
      allow: async () => true,
      verifyAndUpdate: async (proof, value) => {
        assert.equal(proof, tokenHash)
        assert.equal(value, password)
        return outcome
      },
    })
    assert.equal(result.status, status)
    assert.ok(!JSON.stringify(result).includes(tokenHash))
    assert.ok(!JSON.stringify(result).includes(password))
  }
})

test('reset fails closed when limiter is unavailable', async () => {
  const result = await core.resetPassword({ tokenHash, password }, {
    allow: async () => { throw new Error('private details') },
    verifyAndUpdate: async () => assert.fail('Auth must not be invoked'),
  })
  assert.equal(result.status, 503)
  assert.ok(!JSON.stringify(result).includes('private details'))
})

test('JSON input is bounded, including missing, malformed and oversized bodies', async () => {
  assert.deepEqual(await core.readRecoveryPayload(new Request('https://example.com', { method: 'POST', body: JSON.stringify({ email }) })), { email })
  for (const body of [undefined, '{bad', ' '.repeat(4097), JSON.stringify({ password: 'é'.repeat(3000) })]) {
    assert.equal(await core.readRecoveryPayload(new Request('https://example.com', { method: 'POST', body })), null)
  }
})

function adapter(auth) {
  return loadTypeScript('lib/auth/password-recovery-server.ts', {
    '@supabase/supabase-js': {
      createClient: (_url, _key, options) => {
        assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })
        return { auth }
      },
    },
    '@/lib/supabase/admin': { createAdminClient: () => assert.fail('Reset must not use admin authorization') },
    './password-recovery': core,
  })
}

test('reset verifies only recovery proof and uses the resulting nonpersistent user session', async () => {
  const calls = []
  const implementation = adapter({
    verifyOtp: async (params) => { calls.push(['verify', params]); return { data: { session: {}, user: {} }, error: null } },
    updateUser: async (params) => { calls.push(['update', params]); return { error: null } },
    signOut: async (params) => { calls.push(['signOut', params]); return { error: null } },
  })
  assert.equal(await implementation.verifyAndUpdatePassword(tokenHash, password), 'success')
  assert.deepEqual(calls, [
    ['verify', { token_hash: tokenHash, type: 'recovery' }], ['update', { password }], ['signOut', { scope: 'local' }],
  ])
})

test('rejected or expired proof never updates a password', async () => {
  for (const response of [
    { data: { session: null, user: null }, error: { status: 403 } },
    { data: { session: null, user: null }, error: null },
    { data: { session: null, user: null }, error: { status: 500 } },
  ]) {
    const implementation = adapter({
      verifyOtp: async () => response,
      updateUser: async () => assert.fail('Invalid proof must not update password'),
    })
    assert.equal(await implementation.verifyAndUpdatePassword(tokenHash, password), response.error?.status === 500 ? 'unavailable' : 'invalid')
  }
})

test('adapter does not update twice when provider rejects the second proof', async () => {
  let consumed = false
  let updates = 0
  const implementation = adapter({
    verifyOtp: async () => {
      if (consumed) return { data: {}, error: { status: 403 } }
      consumed = true
      return { data: { session: {}, user: {} }, error: null }
    },
    updateUser: async () => { updates++; return { error: null } },
    signOut: async () => ({ error: null }),
  })
  const results = await Promise.all([
    implementation.verifyAndUpdatePassword(tokenHash, password), implementation.verifyAndUpdatePassword(tokenHash, password),
  ])
  assert.deepEqual(results.sort(), ['invalid', 'success'])
  assert.equal(updates, 1)
})

test('concurrent reset handlers reserve one proof atomically before calling Auth', async () => {
  const reserved = new Set()
  let updates = 0
  const deps = {
    allow: async (scope, subject, limit) => {
      if (scope === 'reset-global') return true
      assert.equal(scope, 'reset-proof')
      assert.equal(subject, tokenHash)
      assert.equal(limit, 1)
      if (reserved.has(subject)) return false
      reserved.add(subject)
      return true
    },
    verifyAndUpdate: async () => { updates++; return 'success' },
  }
  const results = await Promise.all([
    core.resetPassword({ tokenHash, password }, deps), core.resetPassword({ tokenHash, password }, deps),
  ])
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400])
  assert.equal(updates, 1)
})

test('password rejection and network failure still attempt to revoke the temporary session', async () => {
  for (const throws of [false, true]) {
    let revoked = false
    const implementation = adapter({
      verifyOtp: async () => ({ data: { session: {}, user: {} }, error: null }),
      updateUser: async () => {
        if (throws) throw new Error('network')
        return { error: { status: 422 } }
      },
      signOut: async () => { revoked = true; return { error: null } },
    })
    if (throws) await assert.rejects(implementation.verifyAndUpdatePassword(tokenHash, password))
    else assert.equal(await implementation.verifyAndUpdatePassword(tokenHash, password), 'password_rejected')
    assert.equal(revoked, true)
  }
})

function requestAdapter(admin, send = async () => ({ error: null })) {
  return loadTypeScript('lib/auth/password-recovery-server.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    './password-recovery': core,
    resend: { Resend: class { emails = { send } } },
  })
}

test('request uses provider-managed recovery generation without listing or creating accounts', async () => {
  const calls = []
  const implementation = requestAdapter({ auth: { admin: {
    generateLink: async (params) => { calls.push(params); return { data: { properties: { hashed_token: tokenHash } }, error: null } },
  } } })
  assert.equal(await implementation.recoveryDependencies().generate(email), tokenHash)
  assert.deepEqual(calls, [{ type: 'recovery', email }])
})

test('missing accounts are neutral; unexpected generation failures are not mistaken for valid links', async () => {
  for (const error of [{ status: 404 }, { status: 422, code: 'user_not_found' }]) {
    const implementation = requestAdapter({ auth: { admin: {
      generateLink: async () => ({ data: null, error }),
    } } })
    assert.equal(await implementation.recoveryDependencies().generate(email), null)
  }
  const implementation = requestAdapter({ auth: { admin: {
    generateLink: async () => ({ data: null, error: { status: 503 } }),
  } } })
  await assert.rejects(implementation.recoveryDependencies().generate(email))
})

test('email API error results are treated as delivery failure, even without an exception', async () => {
  const implementation = requestAdapter({}, async () => ({ error: { message: 'provider error' } }))
  await assert.rejects(implementation.recoveryDependencies().send(email, 'https://worship.example.com/auth/reset'))
})

test('rate limiter stores only keyed digests and requires an explicit boolean result', async () => {
  const seen = []
  const implementation = requestAdapter({ rpc: async (name, params) => {
    seen.push([name, params])
    return { data: true, error: null }
  } })
  assert.equal(await implementation.recoveryLimiter()('request-email', email, 3), true)
  assert.equal(seen[0][0], 'consume_password_recovery_limit')
  assert.match(seen[0][1].p_key, /^[0-9a-f]{64}$/)
  assert.equal(seen[0][1].p_limit, 3)
  assert.ok(!JSON.stringify(seen).includes(email))
  for (const result of [{ data: null, error: { message: 'missing migration' } }, { data: 'true', error: null }]) {
    const broken = requestAdapter({ rpc: async () => result })
    await assert.rejects(broken.recoveryLimiter()('request-email', email, 3))
  }
})

test('request route returns neutral JSON with no-store, not a recovery link', async () => {
  const route = loadTypeScript('app/api/auth/forgot-password/route.ts', {
    '@/lib/auth/password-recovery': core,
    '@/lib/auth/password-recovery-server': { recoveryDependencies: () => dependencies(), recoveryLimiter: () => async () => true },
    '@/lib/auth/client-ip': { clientIp: () => '203.0.113.1' },
  })
  const response = await route.POST(new Request('https://untrusted.example/api/auth/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.ok(!Object.hasOwn(body, 'resetUrl'))
  assert.ok(!JSON.stringify(body).includes(tokenHash))
})

test('request route answers 429 for an address over the WF-46 limit, before any account lookup', async () => {
  let generated = false
  const route = loadTypeScript('app/api/auth/forgot-password/route.ts', {
    '@/lib/auth/password-recovery': core,
    '@/lib/auth/password-recovery-server': {
      recoveryDependencies: () => ({ ...dependencies(), generate: async () => { generated = true; return 'hash' } }),
      recoveryLimiter: () => async (scope) => scope !== 'request-ip',
    },
    '@/lib/auth/client-ip': { clientIp: () => '203.0.113.1' },
  })
  const response = await route.POST(new Request('https://untrusted.example/api/auth/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  }))
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(generated, false)
})

test('reset route rejects legacy input and malformed JSON before password update', async () => {
  const route = loadTypeScript('app/api/auth/reset/route.ts', {
    '@/lib/auth/password-recovery': core,
    '@/lib/auth/password-recovery-server': {
      recoveryLimiter: () => async () => assert.fail('Invalid input must not consume rate limits'),
      verifyAndUpdatePassword: async () => assert.fail('Invalid input must not update passwords'),
    },
  })
  for (const body of ['invalid-json', JSON.stringify({ token: tokenHash, password })]) {
    const response = await route.POST(new Request('https://worship.example.com/api/auth/reset', { method: 'POST', body }))
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.ok(!JSON.stringify(await response.json()).includes(tokenHash))
  }
})
