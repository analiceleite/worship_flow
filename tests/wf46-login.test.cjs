const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

// Same transpile-and-run loader as the other unit tests: no network, no framework.
function loadTypeScript(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const requireMock = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id))
  new Function('require', 'module', 'exports', 'process', outputText)(requireMock, module, module.exports, { env: { NODE_ENV: 'test' } })
  return module.exports
}

function supabaseStub(result, calls) {
  return { createClient: async () => ({ auth: { signInWithPassword: async (input) => { calls.push(input); return result } } }) }
}

function limiterStub(allow) {
  return { recoveryLimiter: () => async (scope) => allow(scope) }
}

test('login refuses before Auth when the address is over its limit', async () => {
  const calls = []
  const core = loadTypeScript('lib/auth/login-server.ts', {
    '@/lib/supabase/server': supabaseStub({ data: {}, error: null }, calls),
    '@/lib/auth/password-recovery-server': limiterStub((scope) => scope !== 'login-ip'),
  })
  const outcome = await core.signInWithPassword({ email: 'a@example.com', password: 'secret-pass' }, '203.0.113.1')
  assert.deepEqual(outcome, { kind: 'limited' })
  assert.equal(calls.length, 0)
})

test('login refuses before Auth when the e-mail is over its limit, whatever the address', async () => {
  const calls = []
  const core = loadTypeScript('lib/auth/login-server.ts', {
    '@/lib/supabase/server': supabaseStub({ data: {}, error: null }, calls),
    '@/lib/auth/password-recovery-server': limiterStub((scope) => scope !== 'login-email'),
  })
  assert.deepEqual(await core.signInWithPassword({ email: 'a@example.com', password: 'secret-pass' }, '203.0.113.1'), { kind: 'limited' })
  assert.equal(calls.length, 0)
})

test('wrong password and unconfirmed account share one outcome', async () => {
  const core = loadTypeScript('lib/auth/login-server.ts', {
    '@/lib/supabase/server': supabaseStub({ data: { user: null, session: null }, error: { status: 400, message: 'Invalid login credentials' } }, []),
    '@/lib/auth/password-recovery-server': limiterStub(() => true),
  })
  assert.deepEqual(await core.signInWithPassword({ email: 'a@example.com', password: 'wrong-pass' }, '203.0.113.1'), { kind: 'invalid' })
})

test('provider outages are reported as unavailable, not as bad credentials', async () => {
  const core = loadTypeScript('lib/auth/login-server.ts', {
    '@/lib/supabase/server': supabaseStub({ data: { user: null, session: null }, error: { status: 503, message: 'down' } }, []),
    '@/lib/auth/password-recovery-server': limiterStub(() => true),
  })
  assert.deepEqual(await core.signInWithPassword({ email: 'a@example.com', password: 'secret-pass' }, '203.0.113.1'), { kind: 'unavailable' })
})

test('successful sign-in reports whether the e-mail is confirmed', async () => {
  const core = loadTypeScript('lib/auth/login-server.ts', {
    '@/lib/supabase/server': supabaseStub({ data: { user: { email_confirmed_at: null } }, error: null }, []),
    '@/lib/auth/password-recovery-server': limiterStub(() => true),
  })
  assert.deepEqual(await core.signInWithPassword({ email: 'a@example.com', password: 'secret-pass' }, '203.0.113.1'), { kind: 'ok', emailConfirmed: false })
})

test('login route rejects untrusted origins and maps outcomes to no-store responses', async () => {
  const outcomes = { value: { kind: 'invalid' } }
  const route = loadTypeScript('app/api/auth/login/route.ts', {
    '@/lib/auth/request-origin': { isTrustedMutationOrigin: (request) => request.headers.get('origin') === 'https://worship.example.com' },
    '@/lib/auth/client-ip': { clientIp: () => '203.0.113.1' },
    '@/lib/auth/login-server': {
      LOGIN_INVALID_MESSAGE: 'invalid', LOGIN_LIMITED_MESSAGE: 'limited',
      loginSchema: require('zod').z.object({ email: require('zod').z.string().email(), password: require('zod').z.string().min(1) }),
      signInWithPassword: async () => outcomes.value,
    },
  })
  const post = (origin, body) => route.POST(new Request('https://worship.example.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  }))
  const body = { email: 'a@example.com', password: 'secret-pass' }

  const foreign = await post('https://evil.example.net', body)
  assert.equal(foreign.status, 403)

  const invalid = await post('https://worship.example.com', body)
  assert.equal(invalid.status, 401)
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store')

  outcomes.value = { kind: 'limited' }
  assert.equal((await post('https://worship.example.com', body)).status, 429)

  outcomes.value = { kind: 'ok', emailConfirmed: true }
  const ok = await post('https://worship.example.com', body)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { emailConfirmed: true })
})
