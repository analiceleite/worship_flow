const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function load(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  })
  const localRequire = createRequire(filename), module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}
const { ROUTES } = load('lib/routes.ts')
const access = load('lib/schedule/access.ts', { '@/lib/routes': { ROUTES } })
const { getMediaCommitments, getScheduleTimeLabels } = load('lib/schedule/media.ts')

test('media can open only the schedule consultation, not descendants or similar paths', () => {
  for (const url of ['/schedule', '/schedule/']) assert.equal(access.canMediaAccessSchedule(url), true)
  for (const url of ['/schedules', '/schedule/admin', '/schedule/admin/builder', '/schedule/other', '/songs']) {
    assert.equal(access.canMediaAccessSchedule(url), false, url)
  }
  assert.deepEqual(Object.values(ROUTES).filter(access.canShowMediaNavigation), ['/repertoire', '/schedule'])
})

test('personal commitments use identity, include today, sort dates and group multiple roles', () => {
  const roles = [{ id: 'sound', name: 'Sonoplasta', display_order: 2 }, { id: 'second', name: 'Outra função', display_order: 1 }]
  const item = { minister_id: 'me', event_date: '2026-12-31', event_type: 'thursday', role_id: 'sound', is_trainee: false }
  const assignments = [
    { ...item, event_date: '2027-01-03', event_type: 'sunday' }, item,
    { ...item, role_id: 'second', is_trainee: true },
    { ...item, event_date: '2026-12-24' },
    { ...item, minister_id: 'homonym' }, { ...item, minister_id: null },
  ]
  const result = getMediaCommitments(assignments, roles, 'me', '2026-12-31')
  assert.equal(result.total, 4)
  assert.deepEqual(result.upcoming.map(item => item.date), ['2026-12-31', '2027-01-03'])
  assert.deepEqual(result.upcoming[0].roles.map(role => role.name), ['Outra função', 'Sonoplasta'])
  assert.equal(result.upcoming[0].roles[0].isTrainee, true)
  assert.deepEqual(getMediaCommitments(assignments, roles, 'absent', '2026-12-31'), { total: 0, upcoming: [] })
  assert.deepEqual(getMediaCommitments(assignments, roles, 'me', '2028-01-01'), { total: 4, upcoming: [] })
})

test('arrival and service come from the selected period/type, never rehearsal overrides or invented defaults', () => {
  const times = { thursday_arrival_time: '19:15:00', thursday_service_time: '20:00:00', sunday_arrival_time: null, sunday_service_time: '18:30:00' }
  assert.deepEqual(getScheduleTimeLabels('thursday', times), { arrival: '19:15', service: '20:00' })
  assert.deepEqual(getScheduleTimeLabels('sunday', times), { arrival: null, service: '18:30' })
})

class AuthContextError extends Error { constructor(message, status) { super(message); this.status = status } }
function route(relativePath, { role = 'midia', tables = {}, authError = null } = {}) {
  const queries = []
  const client = { from(table) {
    const query = { table, filters: [], columns: null }
    queries.push(query)
    const builder = {
      select(columns) { query.columns = columns; return builder },
      eq(column, value) { query.filters.push([column, value]); return builder },
      order() { return builder },
      limit() { return builder },
      single() { return resolve(true) }, maybeSingle() { return resolve(true) },
      then(onFulfilled, onRejected) { return resolve(false).then(onFulfilled, onRejected) },
    }
    function resolve(single) {
      const rows = (tables[table] ?? []).filter(row => query.filters.every(([key, value]) => row[key] === value))
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null })
    }
    return builder
  } }
  const module = load(relativePath, {
    '@/lib/google-calendar/reconcile': { reconcileMinisterCalendar: async () => {}, reconcileMinistersForQuarter: async () => {} },
    '@/lib/notifications/schedule-email': { enqueueBimesterPublishedNotifications: async () => {}, processScheduleEmailQueue: async () => {} },
    '@/lib/schedule/wf32-rules': { quarterRangesOverlap: (a, b) => a.start_date <= b.end_date && a.end_date >= b.start_date, intervalsOverlap: () => false },
    '@/lib/schedule/event-conflicts': { getScheduleEventInterval: () => ({ start: new Date(0), end: new Date(1) }) },
    '@/lib/supabase/admin': { createAdminClient: () => client },
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async (options = {}) => {
      if (authError) throw authError
      if (options.requireAdmin && role !== 'admin') throw new AuthContextError('Forbidden', 403)
      return { churchId: 'church', ministerId: 'me', role, isAdmin: role === 'admin' }
    } },
  })
  return { ...module, queries }
}
const quarters = [
  { id: 'published', church_id: 'church', is_published: true, thursday_arrival_time: '19:15:00' },
  { id: 'draft', church_id: 'church', is_published: false },
  { id: 'foreign', church_id: 'other', is_published: true },
]
const tables = { schedule_quarters: quarters, schedule_roles: [], schedule_assignments: [], schedule_rehearsals: [] }

test('current returns only published own church data and explicitly selects schedule times', async () => {
  const current = route('app/api/schedule/current/route.ts', { tables })
  const response = await current.GET()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).schedule.quarter.id, 'published')
  const query = current.queries.find(q => q.table === 'schedule_quarters')
  for (const column of ['thursday_arrival_time', 'thursday_service_time', 'sunday_arrival_time', 'sunday_service_time']) assert.ok(query.columns.includes(column))
  const empty = route('app/api/schedule/current/route.ts', { tables: { ...tables, schedule_quarters: quarters.slice(1) } })
  assert.equal((await (await empty.GET()).json()).schedule, null)
})

test('quarter list keeps drafts private to admins', async () => {
  for (const role of ['midia', 'admin', 'minister']) {
    const list = route('app/api/schedule/quarters/route.ts', { tables, role })
    assert.deepEqual((await (await list.GET()).json()).quarters.map(q => q.id), role === 'admin' ? ['published', 'draft'] : ['published'])
  }
})

test('media auxiliary and alternative reads reject drafts, foreign and nonexistent quarters before reading children', async () => {
  for (const id of ['draft', 'foreign', 'missing']) {
    const assignments = route('app/api/schedule/quarters/[id]/assignments/route.ts', { tables })
    const response = await assignments.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })
    assert.equal(response.status, 404)
    assert.equal(assignments.queries.some(q => q.table === 'schedule_assignments'), false)
    const rehearsals = route('app/api/schedule/rehearsal/route.ts', { tables })
    const result = await rehearsals.GET(new Request(`http://localhost/api/schedule/rehearsal?quarter_id=${id}`))
    assert.equal(result.status, 404)
    assert.equal(rehearsals.queries.some(q => q.table === 'schedule_rehearsals'), false)
  }
  for (const role of ['midia', 'minister', 'admin']) {
    const assignments = route('app/api/schedule/quarters/[id]/assignments/route.ts', { tables, role })
    assert.equal((await assignments.GET(new Request('http://localhost'), { params: Promise.resolve({ id: role === 'admin' ? 'draft' : 'published' }) })).status, 200)
  }
  const rehearsals = route('app/api/schedule/rehearsal/route.ts', { tables })
  assert.equal((await rehearsals.GET(new Request('http://localhost/api/schedule/rehearsal?quarter_id=published'))).status, 200)
})

test('media writes are refused by APIs even when called directly', async () => {
  const jsonRequest = () => new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quarter_id: 'published', event_date: '2026-11-08', event_type: 'sunday' }) })
  for (const [file, method, params] of [
    ['app/api/schedule/assignment/route.ts', 'PATCH'],
    ['app/api/schedule/quarters/route.ts', 'POST'],
    ['app/api/schedule/quarters/[id]/route.ts', 'DELETE', { params: Promise.resolve({ id: 'published' }) }],
    ['app/api/schedule/rehearsal/route.ts', 'PATCH'],
    ['app/api/schedule/quarters/[id]/publish/route.ts', 'PATCH', { params: Promise.resolve({ id: 'published' }) }],
    ['app/api/schedule/quarters/[id]/import/apply/route.ts', 'POST', { params: Promise.resolve({ id: 'published' }) }],
  ]) {
    const api = route(file, { tables })
    assert.equal((await api[method](jsonRequest(), params)).status, 403, file)
    assert.equal(api.queries.length, 0, file)
  }
})

test('unauthenticated schedule reads return 401', async () => {
  const api = route('app/api/schedule/current/route.ts', { authError: new AuthContextError('No session', 401) })
  assert.equal((await api.GET()).status, 401)
  assert.equal(api.queries.length, 0)
})
