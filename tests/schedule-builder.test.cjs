const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  })
  const module = { exports: {} }, localRequire = createRequire(filename)
  new Function('require', 'module', 'exports', outputText)(id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}
const model = load('lib/schedule/builder-model.ts')
function fixture() {
  const slot = { quarter_id: 'q', is_trainee: false, minister: null }
  return {
    quarter: { id: 'q', sunday_service_time: '18:30:00' },
    roles: [{ id: 'voice', name: 'Voz', display_order: 1 }, { id: 'guitar', name: 'Violão', display_order: 2 }, { id: 'unused', name: 'Não tem célula', display_order: 3 }],
    assignments: [
      { ...slot, id: 'b', role_id: 'guitar', event_date: '2027-01-10', event_type: 'sunday', minister_id: null },
      { ...slot, id: 'a', role_id: 'voice', event_date: '2027-01-10', event_type: 'sunday', minister_id: 'person' },
      { ...slot, id: 'c', role_id: 'voice', event_date: '2027-01-07', event_type: 'thursday', minister_id: 'person' },
      { ...slot, id: 'd', role_id: 'voice', event_date: '2027-01-14', event_type: 'thursday', minister_id: null },
    ],
    event_controls: [
      { event_date: '2027-01-10', event_type: 'sunday', status: 'scheduled', leader_minister_id: 'person', leader: { id: 'person', name: 'Ana' } },
      { event_date: '2027-01-14', event_type: 'thursday', status: 'cancelled', leader_minister_id: null },
    ],
  }
}

test('agenda groups actual cells, preserves role order and never mutates inputs', () => {
  const data = fixture(), snapshot = JSON.stringify(data)
  const events = model.buildEvents(data, [{ event_date: '2027-01-10', event_type: 'sunday', rehearsal_place: 'Sala 1' }])
  assert.deepEqual(events.map(event => event.key), ['2027-01-07_thursday', '2027-01-10_sunday', '2027-01-14_thursday'])
  assert.deepEqual(events[1].assignments.map(item => item.id), ['a', 'b'])
  assert.equal(events[1].total, 2)
  assert.deepEqual(events[1].missing, ['Violão'])
  assert.equal(events[1].rehearsal.rehearsal_place, 'Sala 1')
  assert.equal(JSON.stringify(data), snapshot)
})

test('pending filters and publication summary exclude cancelled events, without inventing requirements', () => {
  const events = model.buildEvents(fixture(), [])
  assert.equal(model.filterEvents(events, 'all', 'all').length, 2)
  assert.deepEqual(model.filterEvents(events, 'pending', 'all').map(event => event.key), ['2027-01-10_sunday'])
  assert.equal(model.filterEvents(events, 'cancelled', 'sunday').length, 0)
  assert.equal(model.filterEvents(events, 'cancelled', 'thursday').length, 1)
  assert.deepEqual(model.summarizeEvents(events), { events: 2, cancelled: 1, filled: 2, total: 3, pendingEvents: 1, withoutLeader: 1 })
})

test('removing last leader assignment clears designation, but another function in same event preserves it', () => {
  const data = fixture()
  const removed = { ...data.assignments.find(item => item.id === 'a'), minister_id: null }
  assert.equal(model.clearUnassignedLeaders(data, removed).event_controls[0].leader_minister_id, null)
  data.assignments[0].minister_id = 'person'
  assert.equal(model.clearUnassignedLeaders(data, removed).event_controls[0].leader_minister_id, 'person')
  assert.equal(data.event_controls[0].leader_minister_id, 'person')
})

test('event times come from period and type, with no invented default', () => {
  assert.equal(model.eventTime(fixture().quarter, 'sunday', 'service'), '18:30')
  assert.equal(model.eventTime(fixture().quarter, 'thursday', 'arrival'), 'Não informado')
})

test('conflict retries require explicit accessible confirmation and preserve request identity', async () => {
  const calls = []
  const { scheduleMutationFetch } = load('lib/schedule/client-mutation.ts', {
    '@/lib/auth/client-context': { selectedChurchFetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return calls.length === 1 ? Response.json({ error: 'Horários sobrepostos', override_allowed: true }, { status: 409 }) : Response.json({ ok: true })
    } },
  })
  const response = await scheduleMutationFetch('/api/schedule/assignment', { method: 'PATCH', body: JSON.stringify({ id: 'cell', minister_id: 'person' }) }, true, async message => {
    assert.equal(message, 'Horários sobrepostos')
    return 'Justificativa explícita'
  })
  assert.equal(response.status, 200)
  assert.deepEqual(calls[1].body, { id: 'cell', minister_id: 'person', conflict_override_reason: 'Justificativa explícita' })
})

test('cancelled confirmation or non-admin cannot trigger an override', async () => {
  for (const allowOverride of [true, false]) {
    let calls = 0
    const { scheduleMutationFetch } = load('lib/schedule/client-mutation.ts', {
      '@/lib/auth/client-context': { selectedChurchFetch: async () => { calls += 1; return Response.json({ error: 'Conflito', override_allowed: true }, { status: 409 }) } },
    })
    const response = await scheduleMutationFetch('/api/schedule/rehearsal', { method: 'PATCH', body: '{}' }, allowOverride, async () => null)
    assert.equal(response.status, 409)
    assert.equal(calls, 1)
  }
})
