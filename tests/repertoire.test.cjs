const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}
const { formatRepertoireWhatsapp } = load('lib/repertoire/whatsapp.ts')
const { repertoirePage, clampRepertoirePage } = load('lib/repertoire/order.ts')

test('25 songs export exactly once, globally numbered with metadata and without mutating items', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: String(i), song: {
    title: `Música ${i + 1}`, artist: 'Artista', tone: 'D', capo_frets: i === 0 ? 2 : 0,
  } }))
  const before = JSON.stringify(items)
  const result = formatRepertoireWhatsapp('Culto de Domingo', '2026-11-08', items)
  const lines = result.split('\n')
  assert.equal(lines[0], 'Repertório - Culto de Domingo (08/11/2026)')
  assert.equal(lines.length, 27)
  assert.equal(lines[2], '1. Música 1 — Artista (Tom D · Capo 2ª)')
  assert.equal(lines[26], '25. Música 25 — Artista (Tom D)')
  for (let i = 1; i <= 25; i++) assert.equal(lines.filter(line => line.startsWith(`${i}. `)).length, 1)
  assert.equal(JSON.stringify(items), before)
})

test('export handles missing metadata and empty events', () => {
  assert.match(formatRepertoireWhatsapp('Evento', '2026-11-08', [{}]), /1\. Sem título — Artista desconhecido$/)
  assert.equal(formatRepertoireWhatsapp('Evento', '2026-11-08', []).split('\n').length, 2)
})

test('global page boundaries and removal of last page', () => {
  for (const [position, expected] of [[1, 1], [10, 1], [11, 2], [20, 2], [21, 3], [25, 3]]) {
    assert.equal(repertoirePage(position), expected)
  }
  assert.equal(clampRepertoirePage(3, 20), 2)
  assert.equal(clampRepertoirePage(3, 5), 1)
  assert.equal(clampRepertoirePage(3, 0), 1)
})

class AuthContextError extends Error {
  constructor(message, status) { super(message); this.status = status }
}
const actor = '00000000-0000-4000-8000-000000000001'
const church = '00000000-0000-4000-8000-000000000002'
const song = '00000000-0000-4000-8000-000000000003'
function route({ rpc = async () => ({ data: { items: [], total: 0, revision: '0' } }), context } = {}) {
  return load('app/api/repertoire/route.ts', {
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: context ?? (async () => ({ userId: actor, churchId: church })) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc }) },
  })
}
function post(body) {
  return new Request('http://localhost/api/repertoire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
test('API derives identity from authenticated context, never request fields', async () => {
  let calls = 0
  const api = route({ rpc: async (name, args) => {
    calls++
    assert.equal(name, 'wf07_mutate')
    assert.equal(args.p_actor, actor)
    assert.equal(args.p_church, church)
    assert.equal(args.p_impersonating, false)
    assert.equal(args.p_revision, '9007199254740993')
    return { data: { items: [], total: 0, revision: '9007199254740994' } }
  } })
  const response = await api.POST(post({ date: '2026-11-08', eventName: 'Culto', expectedRevision: '9007199254740993',
    churchId: song, isAdmin: true, command: { action: 'add', songId: song } }))
  assert.equal(response.status, 200)
  assert.equal(calls, 1)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('API validates date and commands before database access', async () => {
  const api = route({ rpc: () => assert.fail('Invalid input must not reach DB') })
  for (const body of [
    { date: '2026-02-30', eventName: 'Culto', expectedRevision: '1', command: { action: 'add', songId: song } },
    { date: '2026-11-08', eventName: 'Culto', expectedRevision: '1', command: { action: 'move', itemId: song, position: 0 } },
    { date: '2026-11-08', eventName: 'Culto', command: { action: 'remove', itemId: song } },
  ]) assert.equal((await api.POST(post(body))).status, 400)
})

test('API maps conflicts, duplicates and denied access without leaking SQL', async () => {
  for (const [marker, status, code] of [
    ['WF07_CONFLICT', 409, 'REPERTOIRE_CONFLICT'], ['WF07_DUPLICATE', 409, 'SONG_ALREADY_ADDED'],
    ['WF07_FORBIDDEN', 403, 'FORBIDDEN'], ['WF07_NOT_FOUND', 404, 'NOT_FOUND'],
  ]) {
    const api = route({ rpc: async () => ({ error: { message: `${marker}: private SQL details` } }) })
    const response = await api.GET(new Request('http://localhost/api/repertoire?date=2026-11-08&eventName=Culto'))
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.ok(!JSON.stringify(body).includes('private SQL'))
  }
  const denied = route({ context: async () => { throw new AuthContextError('Sessão expirada', 401) } })
  assert.equal((await denied.GET(new Request('http://localhost/api/repertoire'))).status, 401)
})

test('catalog batches all rows, scopes by effective church and excludes heavy fields', async () => {
  const calls = []
  const api = load('app/api/repertoire/catalog/route.ts', {
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async () => ({ userId: actor, churchId: church, isImpersonating: true }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: table => {
      const builder = {
        select: columns => { assert.ok(!columns.includes('*')); assert.ok(!columns.includes('cifra_content')); return builder },
        eq: (field, value) => { assert.equal(field, 'church_id'); assert.equal(value, church); return builder },
        order: field => { assert.equal(field, 'id'); return builder },
        range: async (start, end) => {
          calls.push([table, start, end])
          return { data: Array.from({ length: Math.max(0, Math.min(end + 1, table === 'songs' ? 1001 : 1) - start) }, (_, index) => ({ id: String(start + index) })) }
        },
      }
      return builder
    } }) },
  })
  const response = await api.GET()
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.songs.length, 1001)
  assert.equal(result.ministers.length, 1)
  assert.ok(calls.some(([table, start]) => table === 'songs' && start === 1000))
})

test('on-demand cifra lookup validates identity and church, including impersonation context', async () => {
  let calls = 0
  const filters = []
  const api = load('app/api/repertoire/cifra/route.ts', {
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async () => ({ userId: actor, churchId: church }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: table => {
      calls++
      assert.equal(table, 'songs')
      const builder = { select: () => builder, eq: (field, value) => { filters.push([field, value]); return builder },
        maybeSingle: async () => ({ data: null, error: null }) }
      return builder
    } }) },
  })
  assert.equal((await api.GET(new Request('http://localhost/api/repertoire/cifra?songId=bad'))).status, 400)
  assert.equal(calls, 0)
  assert.equal((await api.GET(new Request(`http://localhost/api/repertoire/cifra?songId=${song}`))).status, 404)
  assert.deepEqual(filters, [['church_id', church], ['id', song]])
})
