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
      return true
    })
    if (query.update) {
      for (const row of table.filter(matches)) Object.assign(row, query.update)
      return { data: null, error: null }
    }
    return { data: table.filter(matches), error: null }
  }

  return {
    from(table) {
      const query = { table, filters: [], update: null }
      const builder = {
        select() { return builder },
        update(values) { query.update = values; return builder },
        eq(column, value) { query.filters.push({ column, op: 'eq', value }); return builder },
        in(column, value) { query.filters.push({ column, op: 'in', value }); return builder },
        lt(column, value) { query.filters.push({ column, op: 'lt', value }); return builder },
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
