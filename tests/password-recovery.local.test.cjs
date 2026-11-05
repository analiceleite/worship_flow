// REAL integration against Docker services. Run ONLY through pnpm local:test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { randomBytes } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { createClient } = require('@supabase/supabase-js')
const ts = require('typescript')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
    process.env.APP_BASE_URL !== 'http://127.0.0.1:3001' || process.env.RESEND_API_KEY) {
  throw new Error('Refusing integration tests outside the isolated local runtime. Use pnpm local:test.')
}

function load(relativePath, aliases = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    (id) => Object.hasOwn(aliases, id) ? aliases[id] : localRequire(id), module, module.exports)
  return module.exports
}

const core = load('lib/auth/password-recovery.ts')
const transport = load('lib/supabase/server-fetch.ts')
const adminModule = load('lib/supabase/admin.ts', { './server-fetch': transport })
const adapter = load('lib/auth/password-recovery-server.ts', {
  '@/lib/supabase/admin': adminModule, './password-recovery': core, '@/lib/supabase/server-fetch': transport,
})
const routeAliases = { '@/lib/auth/password-recovery': core, '@/lib/auth/password-recovery-server': adapter }
const requestRoute = load('app/api/auth/forgot-password/route.ts', routeAliases)
const resetRoute = load('app/api/auth/reset/route.ts', routeAliases)

function post(payload) {
  return new Request('http://127.0.0.1:3001/api/auth/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
}

async function localSql(sql) {
  if (process.env.LOCAL_DOCKER === 'true') {
    const url = new URL(process.env.LOCAL_DATABASE_URL || '')
    assert.ok(url.hostname === 'db' && url.port === '5432' && url.pathname === '/postgres', 'Invalid Compose test database.')
    const client = new (require('pg').Client)({ connectionString: url.toString() })
    await client.connect()
    try { await client.query(sql) } finally { await client.end() }
    return
  }
  const result = spawnSync('docker', ['exec', 'supabase_db_worship_flow_local', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, 'Selective local SQL failed; no SQL output or credentials are printed.')
}

test('recovery with real local Auth, Postgres and Mailpit (no external email)', async (t) => {
  const admin = adminModule.createAdminClient()
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: transport.serverSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `recovery-${randomBytes(8).toString('hex')}@worship.local.test`
  const password = randomBytes(18).toString('base64url') + 'aA1!'
  const newPassword = randomBytes(18).toString('base64url') + 'bB2!'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ok(!created.error && created.data.user, 'Could not create the synthetic local test user.')
  const id = created.data.user.id
  assert.match(id, /^[0-9a-f-]{36}$/)

  async function deliveredProof() {
    const response = await requestRoute.POST(post({ email }))
    assert.equal(response.status, 200, 'Local request route failed.')
    const publicBody = await response.json()
    assert.ok(!Object.hasOwn(publicBody, 'resetUrl'))
    const mailpit = process.env.LOCAL_DOCKER === 'true' ? 'http://mailpit:8025' : 'http://127.0.0.1:54324'
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    assert.ok(search.ok, 'Mailpit search unavailable.')
    const messages = await search.json()
    assert.ok(messages.messages?.length > 0, 'No email captured by Mailpit.')
    const detail = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(messages.messages[0].ID)}`)
    assert.ok(detail.ok)
    const message = await detail.json()
    const match = message.Text?.match(/http:\/\/127\.0\.0\.1:3001\/auth\/reset#[^\s]+/)
    assert.ok(match, 'Captured email did not contain the expected local link.')
    const proof = new URLSearchParams(new URL(match[0]).hash.slice(1)).get('token_hash')
    assert.ok(proof, 'Missing recovery proof in captured email.')
    assert.ok(!JSON.stringify(publicBody).includes(proof))
    return proof
  }

  try {
    if (process.env.LOCAL_DOCKER === 'true') {
      await t.test('Compose Auth owns its migration helpers without superuser privileges', async () => {
        await localSql(`DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'auth' AND p.proname IN ('uid', 'role', 'email')
              AND pg_get_userbyid(p.proowner) <> 'supabase_auth_admin') THEN
            RAISE EXCEPTION 'Unexpected Auth helper owner';
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin' AND rolsuper) THEN
            RAISE EXCEPTION 'Auth must not be superuser';
          END IF;
        END $$;`)
      })
    }
    await t.test('successful reset, replay rejection and login with changed password', async () => {
      const proof = await deliveredProof()
      assert.equal((await resetRoute.POST(post({ tokenHash: proof, password: newPassword }))).status, 200)
      assert.equal((await resetRoute.POST(post({ tokenHash: proof, password }))).status, 400)
      assert.ok(!(await anon.auth.signInWithPassword({ email, password: newPassword })).error, 'New password was not accepted.')
      await anon.auth.signOut({ scope: 'local' })
      assert.ok((await anon.auth.signInWithPassword({ email, password })).error, 'Old password remained valid.')
    })

    await t.test('two concurrent submissions cannot both consume recovery proof', async () => {
      const proof = await deliveredProof()
      const results = await Promise.all([
        resetRoute.POST(post({ tokenHash: proof, password })), resetRoute.POST(post({ tokenHash: proof, password })),
      ])
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400])
    })

    await t.test('provider expiry rejects an expired recovery proof', async () => {
      const proof = await deliveredProof()
      await localSql(`UPDATE auth.users SET recovery_sent_at = now() - interval '2 hours' WHERE id = '${id}';`)
      assert.equal((await resetRoute.POST(post({ tokenHash: proof, password: newPassword }))).status, 400)
    })

    await t.test('atomic limiter enforces a shared counter and renews expired windows', async () => {
      const key = randomBytes(32).toString('hex')
      const consume = () => admin.rpc('consume_password_recovery_limit', { p_key: key, p_limit: 2 })
      const results = await Promise.all([consume(), consume(), consume(), consume()])
      assert.ok(results.every((result) => !result.error), 'Limiter SQL failed.')
      assert.equal(results.filter((result) => result.data === true).length, 2)
      await localSql(`UPDATE public.password_recovery_limits SET expires_at = now() - interval '1 second' WHERE key = '${key}';`)
      assert.equal((await consume()).data, true)
      await admin.from('password_recovery_limits').delete().eq('key', key)
    })

    await t.test('anonymous and authenticated users cannot access private recovery tables or RPC', async () => {
      for (const authenticated of [false, true]) {
        if (authenticated) assert.ok(!(await anon.auth.signInWithPassword({ email, password })).error)
        assert.ok((await anon.from('password_recovery_limits').select('key')).error)
        assert.ok((await anon.from('password_resets').select('token')).error)
        assert.ok((await anon.rpc('consume_password_recovery_limit', { p_key: randomBytes(32).toString('hex'), p_limit: 2 })).error)
      }
      await anon.auth.signOut({ scope: 'local' })
    })
  } finally {
    // Delete ONLY the synthetic user created by this test, never seeded accounts.
    const removed = await admin.auth.admin.deleteUser(id)
    assert.ok(!removed.error, 'Synthetic local user cleanup failed.')
  }
})
