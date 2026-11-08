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
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}

const rules = load('lib/schedule/wf32-rules.ts')
const eventTime = load('lib/schedule/event-time.ts', { '@/lib/schedule/wf32-rules': rules })
const eventConflicts = load('lib/schedule/event-conflicts.ts', { '@/lib/schedule/event-time': eventTime })

test('period overlap uses inclusive dates and rejects a shared boundary day', () => {
  assert.equal(rules.quarterRangesOverlap(
    { start_date: '2026-01-01', end_date: '2026-03-31' },
    { start_date: '2026-04-01', end_date: '2026-06-30' },
  ), false)
  assert.equal(rules.quarterRangesOverlap(
    { start_date: '2026-01-01', end_date: '2026-03-31' },
    { start_date: '2026-03-31', end_date: '2026-06-30' },
  ), true)
})

test('timezone conversion respects IANA offsets and rejects invalid or ambiguous wall times', () => {
  assert.equal(rules.churchLocalDateTimeToUtc('2026-01-10', '10:00', 'America/Sao_Paulo').toISOString(), '2026-01-10T13:00:00.000Z')
  assert.equal(rules.churchLocalDateTimeToUtc('2026-01-10', '10:00', 'America/New_York').toISOString(), '2026-01-10T15:00:00.000Z')
  assert.throws(() => rules.churchLocalDateTimeToUtc('2026-03-08', '02:30', 'America/New_York'), /não existe/)
  assert.throws(() => rules.churchLocalDateTimeToUtc('2026-11-01', '01:30', 'America/New_York'), /ambíguo/)
  assert.throws(() => rules.churchLocalDateTimeToUtc('2026-02-31', '10:00', 'America/Sao_Paulo'), /Data inválida/)
  assert.equal(rules.isValidTimeZone('Not/AZone'), false)
})

test('event conflict intervals span rehearsal/arrival through service end in church timezone', () => {
  const quarter = {
    id: 'q1', start_date: '2026-01-01', end_date: '2026-03-31',
    thursday_arrival_time: '23:00', thursday_service_time: '23:30',
    sunday_arrival_time: '16:00', sunday_service_time: '18:30',
  }
  const interval = eventConflicts.getScheduleEventInterval({
    event: { quarter_id: 'q1', event_date: '2026-01-08', event_type: 'thursday' },
    quarter, timeZone: 'America/Sao_Paulo',
  })
  assert.equal(interval.start.toISOString(), '2026-01-09T02:00:00.000Z')
  assert.equal(interval.end.toISOString(), '2026-01-09T04:00:00.000Z')
  const adjacent = { ...interval, eventDate: '2026-01-09', start: interval.end, end: new Date(interval.end.getTime() + 60_000) }
  assert.equal(rules.intervalsOverlap(interval, adjacent), false)
  assert.equal(rules.intervalsOverlap(interval, { ...adjacent, start: new Date(interval.end.getTime() - 1) }), true)
})
