const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const { NextRequest } = require('next/server')

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  })
  const localRequire = createRequire(filename), module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports)
  return module.exports
}
const { ROUTES } = load('lib/routes.ts')
const memberships = load('lib/auth/membership.ts')
const preference = load('lib/auth/context-selection.ts')
const access = load('lib/schedule/access.ts', { '@/lib/routes': { ROUTES } })
const church = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const member = { id: 'member', church_id: church, role: 'minister', access_state: 'active' }

async function navigate(pathname, options = {}) {
  const calls = []
  const api = load('middleware.ts', {
    '@supabase/ssr': { createServerClient: (_url, _key, config) => ({
      auth: { getUser: async () => {
        if (options.refresh) config.cookies.setAll([{ name: 'test-session', value: 'refreshed', options: { httpOnly: true } }])
        return { data: { user: options.anonymous ? null : { id: 'actor' } } }
      } },
      from: table => {
        calls.push(table)
        const chain = {
          select: () => chain, eq: () => chain,
          maybeSingle: async () => ({ data: { last_church_id: options.lastChurch ?? null }, error: null }),
          in: async () => ({ data: options.churches ?? [{ id: church, status: 'active' }], error: null }),
          then: (resolve, reject) => Promise.resolve({ data: options.members ?? [member], error: options.databaseError ?? null }).then(resolve, reject),
        }
        return chain
      },
    }) },
    '@/lib/routes': { ROUTES }, '@/lib/supabase/server-fetch': { serverSupabaseFetch: () => assert.fail('No network') },
    '@/lib/schedule/access': access, '@/lib/auth/membership': memberships, '@/lib/auth/context-selection': preference,
  })
  const request = new NextRequest(`http://localhost${pathname}`, { headers: options.cookie ? { cookie: `${preference.CHURCH_CONTEXT_COOKIE}=${encodeURIComponent(options.cookie)}` } : undefined })
  return { response: await api.middleware(request), calls }
}

test('a code query parameter and similar auth paths cannot bypass authentication', async () => {
  for (const route of ['/songs?code=untrusted', '/auth/login-extra', '/auth/select-church']) {
    const { response, calls } = await navigate(route, { anonymous: true })
    assert.equal(new URL(response.headers.get('location')).pathname, ROUTES.AUTH_LOGIN)
    assert.equal(calls.length, 0)
  }
  assert.equal((await navigate('/auth/reset/opaque-token', { anonymous: true })).response.status, 200)
})

test('authenticated selection requires no active membership and never logs the person out', async () => {
  const { response, calls } = await navigate('/auth/select-church', { members: [] })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(calls.length, 0)
  const recovery = await navigate('/auth/forgot-password', { members: [] })
  assert.equal(recovery.response.status, 200)
  assert.equal(recovery.calls.length, 0)
  const platform = await navigate('/platform/churches', { members: [] })
  assert.equal(platform.response.status, 200)
  assert.equal(platform.calls.length, 0)
  for (const members of [[], [{ ...member, access_state: 'pending' }], [{ ...member, access_state: 'suspended' }]]) {
    const result = await navigate('/songs', { members, refresh: true })
    assert.equal(new URL(result.response.headers.get('location')).pathname, ROUTES.AUTH_SELECT_CHURCH)
    assert.equal(result.response.cookies.get('test-session').value, 'refreshed')
  }
})

test('normal roles preserve their landing pages and media schedule boundaries', async () => {
  assert.equal(new URL((await navigate('/')).response.headers.get('location')).pathname, ROUTES.SONGS)
  assert.equal(new URL((await navigate('/', { members: [{ ...member, role: 'admin' }] })).response.headers.get('location')).pathname, ROUTES.SCHEDULE_ADMIN_DASHBOARD)
  const media = { members: [{ ...member, role: 'midia' }] }
  assert.equal((await navigate('/schedule', media)).response.status, 200)
  assert.equal(new URL((await navigate('/schedule/admin', media)).response.headers.get('location')).pathname, ROUTES.HOME)
  assert.equal(new URL((await navigate('/songs', media)).response.headers.get('location')).pathname, ROUTES.REPERTOIRE)
})

test('explicit church, own preference and local role are resolved independently', async () => {
  const options = { members: [member, { ...member, id: 'other', church_id: other, role: 'admin' }], churches: [{ id: church, status: 'active' }, { id: other, status: 'active' }] }
  assert.equal(new URL((await navigate('/users', options)).response.headers.get('location')).pathname, ROUTES.AUTH_SELECT_CHURCH)
  assert.equal((await navigate(`/users?churchId=${other}`, options)).response.status, 200)
  assert.equal(new URL((await navigate(`/users?churchId=${church}`, { ...options, lastChurch: other })).response.headers.get('location')).pathname, ROUTES.HOME)
  assert.equal((await navigate('/users', { ...options, lastChurch: other })).response.status, 200)
  assert.equal((await navigate('/users', { ...options, cookie: preference.churchPreferenceValue('actor', other) })).response.status, 200)
  assert.equal(new URL((await navigate('/users', { ...options, cookie: preference.churchPreferenceValue('different-person', other) })).response.headers.get('location')).pathname, ROUTES.AUTH_SELECT_CHURCH)
})
