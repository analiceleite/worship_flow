const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', 'window', outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
    mocks.fetch ?? (() => assert.fail('Unexpected network request in a unit test')), mocks.window,
  )
  return module.exports
}

function fakeAdmin(tables) {
  function run(query) {
    const table = tables[query.table] ?? []
    const matches = row => query.filters.every(filter => {
      if (filter.op === 'eq') return row[filter.column] === filter.value
      if (filter.op === 'in') return filter.value.includes(row[filter.column])
      if (filter.op === 'lt') return row[filter.column] < filter.value
      if (filter.op === 'notNull') return row[filter.column] != null
      return true
    })
    if (query.upsert) {
      for (const row of query.upsert) {
        const existing = table.find(item => item.dedupe_key === row.dedupe_key)
        if (!existing) table.push(row)
        else if (!query.ignoreDuplicates) Object.assign(existing, row)
      }
      tables[query.table] = table
      return { data: null, error: null }
    }
    if (query.update) {
      if (query.update.status === 'sent') {
        const failing = table.find(row => matches(row) && row.fail_next_sent)
        if (failing) { failing.fail_next_sent = false; return { data: null, error: { message: 'Simulated DB failure after provider accepted email' } } }
      }
      for (const row of table.filter(matches)) Object.assign(row, query.update)
      return { data: null, error: null }
    }
    return { data: table.filter(matches), error: null }
  }

  return {
    async rpc(name, { p_id }) {
      assert.equal(name, 'wf32_claim_email')
      const row = (tables.schedule_email_notifications ?? []).find(row => row.id === p_id)
      if (!row || !['pending', 'failed'].includes(row.status) || row.attempts >= 3) return { data: null, error: null }
      row.status = 'processing'
      row.attempts += 1
      return { data: row.attempts, error: null }
    },
    from(table) {
      const query = { table, filters: [], update: null }
      const builder = {
        select() { return builder },
        update(values) { query.update = values; return builder },
        upsert(values, options) { query.upsert = values; query.ignoreDuplicates = options.ignoreDuplicates; return builder },
        not(column) { query.filters.push({ column, op: 'notNull' }); return builder },
        eq(column, value) { query.filters.push({ column, op: 'eq', value }); return builder },
        in(column, value) { query.filters.push({ column, op: 'in', value }); return builder },
        lt(column, value) { query.filters.push({ column, op: 'lt', value }); return builder },
        or() { return builder },
        order() { return builder },
        limit() { return builder },
        then(resolve, reject) { return Promise.resolve(run(query)).then(resolve, reject) },
      }
      return builder
    },
  }
}

function schedulerWith(tables, fetchImpl) {
  return load('lib/notifications/schedule-email.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => fakeAdmin(tables) },
    '@/lib/routes': { ROUTES: { SCHEDULE: '/schedule' } },
    '@/lib/schedule/event-time': { BRAZIL_UTC_OFFSET_HOURS: 3, computeEventArrivalDateTime: () => new Date(0) },
    fetch: fetchImpl,
  })
}

function fixture(overrides = {}) {
  return {
    schedule_email_notifications: [{
      id: 'queue-1', church_id: 'church-1', minister_id: 'minister-1',
      notification_type: 'reminder_offset', attempts: 0, status: 'pending',
      payload_json: { minister_email: 'stale@example.com', minister_name: 'Nome antigo', items: [] },
      church: { status: 'active', environment: 'production', email_mode: 'real' },
      ...overrides.queueRow,
    }],
    ministers: [{
      id: 'minister-1', church_id: 'church-1', user_id: 'user-1', name: 'Pessoa atual',
      email: 'current@example.com', is_active: true, access_state: 'active',
      email_reminders_enabled: true, ...overrides.minister,
    }],
    user_profiles: [{
      user_id: 'user-1', optional_notifications_paused: false, ...overrides.profile,
    }],
  }
}

test('send-time revalidation skips paused, disabled, suspended and closed contexts', async () => {
  const scenarios = [
    { name: 'personal pause', tables: fixture({ profile: { optional_notifications_paused: true } }), reason: /pausadas/ },
    { name: 'local preference', tables: fixture({ minister: { email_reminders_enabled: false } }), reason: /Preferência/ },
    { name: 'suspended membership', tables: fixture({ minister: { access_state: 'suspended' } }), reason: /inativo/ },
    { name: 'closed church', tables: fixture({ queueRow: { church: { status: 'inactive', environment: 'production', email_mode: 'real' } } }), reason: /Igreja/ },
  ]

  for (const scenario of scenarios) {
    const scheduler = schedulerWith(scenario.tables, () => assert.fail(`Must not send: ${scenario.name}`))
    const result = await scheduler.processScheduleEmailQueue(10)
    assert.deepEqual(result, { processed: 1, sent: 0, failed: 0, skipped: 1 })
    assert.equal(scenario.tables.schedule_email_notifications[0].status, 'skipped')
    assert.match(String(scenario.tables.schedule_email_notifications[0].last_error), scenario.reason)
  }
})

test('send-time revalidation uses the current identity and sends only when allowed', async () => {
  const previousKey = process.env.RESEND_API_KEY
  const previousFrom = process.env.RESEND_FROM_EMAIL
  process.env.RESEND_API_KEY = 'local-test-only'
  process.env.RESEND_FROM_EMAIL = 'test@local.test'
  try {
    const tables = fixture()
    let calls = 0
    const scheduler = schedulerWith(tables, async (url, init) => {
      calls += 1
      assert.equal(url, 'https://api.resend.com/emails')
      assert.equal(init.headers['Idempotency-Key'], 'wf-schedule-queue-1')
      const body = JSON.parse(init.body)
      assert.deepEqual(body.to, ['current@example.com'])
      assert.match(body.text, /Pessoa atual/)
      return new Response('{}', { status: 200 })
    })
    const result = await scheduler.processScheduleEmailQueue(10)
    assert.deepEqual(result, { processed: 1, sent: 1, failed: 0, skipped: 0 })
    assert.equal(calls, 1)
    assert.equal(tables.schedule_email_notifications[0].status, 'sent')
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousKey
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL
    else process.env.RESEND_FROM_EMAIL = previousFrom
  }
})

test('concurrent workers claim an email once', async () => {
  const tables = fixture({ queueRow: { church: { status: 'active', environment: 'test', email_mode: 'disabled' } } })
  const scheduler = schedulerWith(tables, () => assert.fail('No real mail in this test'))
  const results = await Promise.all([scheduler.processScheduleEmailQueue(), scheduler.processScheduleEmailQueue()])
  assert.equal(results.reduce((total, result) => total + result.processed, 0), 1)
  assert.equal(tables.schedule_email_notifications[0].attempts, 1)
})

test('retry after provider success and database failure reuses exact request and idempotency key', async () => {
  const previousKey = process.env.RESEND_API_KEY, previousFrom = process.env.RESEND_FROM_EMAIL
  process.env.RESEND_API_KEY = 'local-test-only'
  process.env.RESEND_FROM_EMAIL = 'test@local.test'
  try {
    const tables = fixture({ queueRow: { fail_next_sent: true } })
    const requests = []
    const scheduler = schedulerWith(tables, async (_, init) => {
      requests.push({ key: init.headers['Idempotency-Key'], body: init.body })
      return new Response('{}', { status: 200 })
    })
    assert.equal((await scheduler.processScheduleEmailQueue()).failed, 1)
    tables.ministers[0].name = 'Renamed between attempts'
    assert.equal((await scheduler.processScheduleEmailQueue()).sent, 1)
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0], requests[1])
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = previousFrom
  }
})

test('uncertain delivery is not resent beyond provider idempotency window', async () => {
  const tables = fixture({ queueRow: { delivery_started_at: new Date(Date.now() - 25 * 3600_000).toISOString() } })
  const scheduler = schedulerWith(tables, () => assert.fail('Must not resend after idempotency expiry'))
  const result = await scheduler.processScheduleEmailQueue()
  assert.equal(result.failed, 1)
  assert.equal(tables.schedule_email_notifications[0].attempts, 3)
  assert.match(tables.schedule_email_notifications[0].last_error, /conferência manual/)
})

test('publication reconciliation preserves queued retries, attempts and original payload', async () => {
  const tables = {
    schedule_assignments: [{ church_id:'church', quarter_id:'quarter', minister_id:'person', event_date:'2026-01-08', event_type:'thursday',
      minister:{ id:'person', name:'Person', email:'person@local.test', is_active:true }, role:{ name:'Voice' } }],
    schedule_email_notifications: [],
  }
  const scheduler = schedulerWith(tables)
  const input = { churchId:'church', bimesterId:'quarter', bimesterName:'Quarter', publicationRevision:4 }
  await scheduler.enqueueBimesterPublishedNotifications(input)
  assert.equal(tables.schedule_email_notifications.length, 1)
  assert.equal(tables.schedule_email_notifications[0].dedupe_key, 'quarter_published:church:quarter:4:person')
  tables.schedule_email_notifications[0].status = 'failed'
  tables.schedule_email_notifications[0].attempts = 2
  const snapshot = JSON.stringify(tables.schedule_email_notifications[0])
  await scheduler.enqueueBimesterPublishedNotifications({ ...input, bimesterName:'Cosmetic rename' })
  assert.equal(JSON.stringify(tables.schedule_email_notifications[0]), snapshot)
})

test('cron passes the same publication revision as the publication operation', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'local-cron-test'
  try {
    const calls = []
    const api = load('app/api/notifications/schedule/enqueue-published/route.ts', {
      '@/lib/supabase/admin': { createAdminClient: () => fakeAdmin({ schedule_quarters:[{id:'quarter',church_id:'church',name:'Quarter',is_published:true,publication_revision:4}] }) },
      '@/lib/notifications/schedule-email': { enqueueBimesterPublishedNotifications: async input => { calls.push(input); return {queued:0} } },
    })
    const response = await api.POST(new Request('http://localhost', {method:'POST',headers:{'x-cron-secret':'local-cron-test'}}))
    assert.equal(response.status, 200)
    assert.equal(calls[0].publicationRevision, 4)
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous
  }
})
