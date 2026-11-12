// WF-38: database rules for public church creation (quota, idempotency, verified e-mail).
// Runs against the isolated local runtime only. Fixtures are committed for the concurrency
// check, so every fixture is removed in a finally block.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY) {
  throw new Error('Use the isolated local runtime; refusing non-local integration tests.')
}
const url = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (!((url.hostname === '127.0.0.1' && url.port === '54322') ||
    (process.env.LOCAL_DOCKER === 'true' && url.hostname === 'db' && url.port === '5432')) || url.pathname !== '/postgres') {
  throw new Error('Refusing non-local integration database')
}

async function connect() {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  return db
}

async function createUser(db, { verified = true } = {}) {
  const id = randomUUID()
  await db.query(
    'INSERT INTO auth.users(id, email, email_confirmed_at) VALUES($1, $2, $3)',
    [id, `${id}@wf38.local.test`, verified ? new Date() : null],
  )
  return id
}

async function create(db, creator, key, name, adminName = 'Responsável') {
  try {
    const { rows } = await db.query(
      'SELECT public.wf38_create_church_for_identity($1, $2, $3, $4) AS result',
      [creator, key, name, adminName],
    )
    return { ok: true, result: rows[0].result }
  } catch (error) {
    return { ok: false, message: error.message }
  }
}

async function cleanup(users) {
  const db = await connect()
  try {
    await db.query("SET wf04.maintenance = 'on'")
    const { rows } = await db.query(
      'SELECT church_id FROM public.church_creation_intents WHERE creator_user_id = ANY($1::uuid[])',
      [users],
    )
    const churches = rows.map(row => row.church_id)
    await db.query('DELETE FROM public.church_creation_allowances WHERE user_id = ANY($1::uuid[])', [users])
    await db.query('DELETE FROM public.church_creation_intents WHERE creator_user_id = ANY($1::uuid[])', [users])
    await db.query('DELETE FROM public.ministers WHERE user_id = ANY($1::uuid[])', [users])
    await db.query('DELETE FROM public.churches WHERE id = ANY($1::uuid[])', [churches])
    await db.query('DELETE FROM public.user_profiles WHERE user_id = ANY($1::uuid[])', [users])
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [users])
  } finally {
    await db.end()
  }
}

test('WF-38: unverified identity cannot create a church and consumes no quota', async () => {
  const db = await connect()
  const user = await createUser(db, { verified: false })
  try {
    const attempt = await create(db, user, randomUUID(), 'Igreja Pendente')
    assert.equal(attempt.ok, false)
    assert.match(attempt.message, /WF38_EMAIL_NOT_VERIFIED/)
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.church_creation_intents WHERE creator_user_id = $1', [user])
    assert.equal(rows[0].n, 0)
  } finally {
    await db.end()
    await cleanup([user])
  }
})

test('WF-38: creation provisions the church and a non-platform first ADMIN atomically', async () => {
  const db = await connect()
  const user = await createUser(db)
  try {
    const first = await create(db, user, randomUUID(), 'Igreja Esperança')
    assert.equal(first.ok, true, first.message)
    assert.equal(first.result.status, 'created')
    assert.match(first.result.slug, /^igreja-esperanca/)

    const { rows: membership } = await db.query(
      'SELECT role, access_state, is_active, church_id FROM public.ministers WHERE user_id = $1',
      [user],
    )
    assert.equal(membership.length, 1)
    assert.deepEqual(
      { role: membership[0].role, access_state: membership[0].access_state, is_active: membership[0].is_active },
      { role: 'admin', access_state: 'active', is_active: true },
    )
    assert.equal(membership[0].church_id, first.result.church_id)

    const { rows: platform } = await db.query('SELECT count(*)::int AS n FROM public.platform_admins WHERE user_id = $1', [user])
    assert.equal(platform[0].n, 0)
  } finally {
    await db.end()
    await cleanup([user])
  }
})

test('WF-38: retry of the same intention returns the same church and consumes no new quota', async () => {
  const db = await connect()
  const user = await createUser(db)
  try {
    const key = randomUUID()
    const first = await create(db, user, key, 'Igreja Retry')
    const second = await create(db, user, key, 'Igreja Retry')
    assert.equal(first.ok, true, first.message)
    assert.equal(second.ok, true, second.message)
    assert.equal(second.result.status, 'existing')
    assert.equal(second.result.church_id, first.result.church_id)

    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.churches WHERE id = $1', [first.result.church_id])
    assert.equal(rows[0].n, 1)
  } finally {
    await db.end()
    await cleanup([user])
  }
})

test('WF-38: same key with a different name is rejected instead of silently reused', async () => {
  const db = await connect()
  const user = await createUser(db)
  try {
    const key = randomUUID()
    assert.equal((await create(db, user, key, 'Igreja Original')).ok, true)
    const conflict = await create(db, user, key, 'Igreja Diferente')
    assert.equal(conflict.ok, false)
    assert.match(conflict.message, /WF38_IDEMPOTENCY_CONFLICT/)
  } finally {
    await db.end()
    await cleanup([user])
  }
})

test('WF-38: one church per identity; a platform allowance is the only way to create more', async () => {
  const db = await connect()
  const user = await createUser(db)
  const platform = await createUser(db)
  try {
    assert.equal((await create(db, user, randomUUID(), 'Primeira Igreja')).ok, true)
    const blocked = await create(db, user, randomUUID(), 'Segunda Igreja')
    assert.equal(blocked.ok, false)
    assert.match(blocked.message, /WF38_QUOTA_EXCEEDED/)

    await db.query(
      'INSERT INTO public.church_creation_allowances(user_id, extra_churches, granted_by, reason) VALUES($1, 1, $2, $3)',
      [user, platform, 'Exceção aprovada para teste'],
    )
    const allowed = await create(db, user, randomUUID(), 'Segunda Igreja')
    assert.equal(allowed.ok, true, allowed.message)

    const blockedAgain = await create(db, user, randomUUID(), 'Terceira Igreja')
    assert.equal(blockedAgain.ok, false)
    assert.match(blockedAgain.message, /WF38_QUOTA_EXCEEDED/)
  } finally {
    await db.end()
    await cleanup([user, platform])
  }
})

test('WF-38: concurrent attempts by one identity create exactly one church', async () => {
  const setup = await connect()
  const user = await createUser(setup)
  await setup.end()
  const clients = await Promise.all([connect(), connect(), connect()])
  try {
    const outcomes = await Promise.all(clients.map(client => create(client, user, randomUUID(), `Corrida ${randomUUID().slice(0, 4)}`)))
    const created = outcomes.filter(outcome => outcome.ok)
    const refused = outcomes.filter(outcome => !outcome.ok)
    assert.equal(created.length, 1)
    assert.equal(refused.length, 2)
    refused.forEach(outcome => assert.match(outcome.message, /WF38_QUOTA_EXCEEDED/))

    const check = await connect()
    try {
      const { rows } = await check.query('SELECT count(*)::int AS n FROM public.church_creation_intents WHERE creator_user_id = $1', [user])
      assert.equal(rows[0].n, 1)
    } finally {
      await check.end()
    }
  } finally {
    await Promise.all(clients.map(client => client.end()))
    await cleanup([user])
  }
})

test('WF-38: rejected input does not consume the quota', async () => {
  const db = await connect()
  const user = await createUser(db)
  try {
    const invalid = await create(db, user, randomUUID(), 'x')
    assert.equal(invalid.ok, false)
    assert.match(invalid.message, /WF38_INVALID_CHURCH_NAME/)

    const valid = await create(db, user, randomUUID(), 'Igreja Válida')
    assert.equal(valid.ok, true, valid.message)
  } finally {
    await db.end()
    await cleanup([user])
  }
})
