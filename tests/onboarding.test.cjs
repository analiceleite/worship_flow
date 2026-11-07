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

const { resolveMembership } = load('lib/auth/membership.ts')
const requestOrigin = load('lib/auth/request-origin.ts')
const contextSelection = load('lib/auth/context-selection.ts')
const { ROUTES } = load('lib/routes.ts')
const church = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const member = { id: 'member', church_id: church, role: 'minister', access_state: 'active', church_status: 'active' }

test('a single accessible church is selected without mutating memberships', () => {
  const memberships = Object.freeze([Object.freeze({ ...member })])
  assert.deepEqual(resolveMembership(memberships), { kind: 'selected', membership: member })
})

test('multiple churches require selection and preserve local roles', () => {
  const second = { ...member, id: 'second', church_id: other, role: 'admin' }
  assert.deepEqual(resolveMembership([member, second]), { kind: 'selection_required' })
  assert.deepEqual(resolveMembership([member, second], other), { kind: 'selected', membership: second })
})

test('pending, suspended, inactive and inaccessible explicit destinations fail closed', () => {
  for (const membership of [
    { ...member, access_state: 'pending' }, { ...member, access_state: 'suspended' },
    { ...member, church_status: 'inactive' },
  ]) {
    assert.deepEqual(resolveMembership([membership]), { kind: 'unavailable' })
    assert.deepEqual(resolveMembership([membership], church), { kind: 'unavailable' })
  }
  assert.deepEqual(resolveMembership([]), { kind: 'unavailable' })
  assert.deepEqual(resolveMembership([member], other), { kind: 'unavailable' })
})

class AuthContextError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

function accessRoute(options = {}) {
  const calls = []
  const api = load('app/api/ministers/[id]/access/route.ts', {
    '@/lib/auth/request-origin': requestOrigin,
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async argument => {
      assert.deepEqual(argument, { requireAdmin: true })
      if (options.denied) throw new AuthContextError('Restrito', 403)
      return { userId: 'actor', churchId: church, isImpersonating: false }
    } },
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: { id: other, access_state: args.p_state }, error: options.error || null }
    } }) },
  })
  return { api, calls }
}
function changeRequest(body, origin = 'http://localhost') {
  return new Request(`http://localhost/api/ministers/${other}/access`, {
    method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ id: other }) }

test('access changes derive actor and church from the authenticated context', async () => {
  const { api, calls } = accessRoute()
  assert.equal((await api.PATCH(changeRequest({ state: 'suspended' }), params)).status, 200)
  assert.deepEqual(calls, [{ name: 'wf04_set_membership_access', args: {
    p_actor: 'actor', p_church: church, p_minister: other, p_state: 'suspended', p_support: false,
  } }])
})

test('invalid bodies, untrusted origin and non-admin sessions cannot mutate access', async () => {
  for (const [body, origin, options, expected] of [
    [{ state: 'pending' }, 'http://localhost', {}, 400],
    [{ state: 'active', p_actor: 'intruder' }, 'http://localhost', {}, 400],
    [{ state: 'active' }, 'https://untrusted.example', {}, 403],
    [{ state: 'active' }, 'http://localhost', { denied: true }, 403],
  ]) {
    const { api, calls } = accessRoute(options)
    assert.equal((await api.PATCH(changeRequest(body, origin), params)).status, expected)
    assert.equal(calls.length, 0)
  }
})

test('last-admin and pending invitations are conflicts, unexpected DB failures stay generic', async () => {
  for (const [message, status] of [['WF04_LAST_ADMIN', 409], ['WF04_INVITATION_REQUIRED', 409],
    ['WF04_FORBIDDEN', 403], ['WF04_UNAVAILABLE', 404], ['private database details', 503]]) {
    const { api } = accessRoute({ error: { message } })
    const response = await api.PATCH(changeRequest({ state: 'suspended' }), params)
    assert.equal(response.status, status)
    assert.ok(!(await response.text()).includes('private database details'))
  }
})

test('legacy DELETE never calls a mutation or global auth deletion', async () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: other }, error: null }) }
  const api = load('app/api/ministers/[id]/route.ts', {
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async () => ({ churchId: church }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: () => chain }) },
  })
  assert.equal((await api.DELETE(new Request('http://localhost'), params)).status, 409)
})

function contextModule(options = {}) {
  const memberships = options.memberships ?? [{ ...member }]
  const admin = { from: table => {
    const chain = {
      select: () => chain, eq: () => chain,
      in: async () => ({ data: options.churches ?? [{ id: church, name: 'Igreja A', status: 'active' }], error: null }),
      then: (resolve, reject) => Promise.resolve({ data: memberships, error: options.databaseError ?? null }).then(resolve, reject),
      maybeSingle: async () => ({ data: null, error: null }),
    }
    assert.equal(table, 'ministers') // church calls override from below
    return chain
  } }
  const from = admin.from
  admin.from = table => table === 'user_profiles' ? {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { last_church_id: options.lastChurch ?? null }, error: null }) }) }),
  } : table === 'churches' ? {
    select: () => ({ in: async () => ({ data: options.churches ?? [{ id: church, name: 'Igreja A', status: 'active' }], error: null }) }),
  } : from(table)
  return load('lib/auth-context.ts', {
    'next/headers': { headers: async () => new Headers(options.headers ?? {}), cookies: async () => ({ get: name => name === contextSelection.CHURCH_CONTEXT_COOKIE && options.cookie ? { value: options.cookie } : undefined }) },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/supabase/server': { createClient: () => assert.fail('Identity-only resolver must be used') },
    '@/lib/auth/identity': { getAuthenticatedIdentity: async () => options.anonymous ? null : { id: 'actor' } },
    '@/lib/auth/membership': { resolveMembership },
    '@/lib/auth/context-selection': contextSelection,
  })
}

test('server context validates identity, state and role instead of trusting requested tenant', async () => {
  const api = contextModule()
  const context = await api.getCurrentMinisterContext()
  assert.equal(context.churchId, church)
  assert.equal(context.ministerId, member.id)
  assert.equal(context.role, 'minister')
  await assert.rejects(api.getCurrentMinisterContext({ requireAdmin: true }), error => error.status === 403)
  await assert.rejects(contextModule({ anonymous: true }).getCurrentMinisterContext(), error => error.status === 401)
  await assert.rejects(contextModule({ headers: { 'x-wf-church-id': other } }).getCurrentMinisterContext(), error => error.status === 403)
  await assert.rejects(contextModule({ headers: { 'x-wf-church-id': 'invalid' } }).getCurrentMinisterContext(), error => error.status === 400)
  await assert.rejects(contextModule({ memberships: [{ ...member, access_state: 'suspended' }] }).getCurrentMinisterContext(), error => error.status === 403)
})

test('server context refuses ambiguous selection and database failures without guessing', async () => {
  const second = { ...member, id: 'second', church_id: other, role: 'admin' }
  const options = { memberships: [member, second], churches: [
    { id: church, name: 'A', status: 'active' }, { id: other, name: 'B', status: 'active' },
  ] }
  await assert.rejects(contextModule(options).getCurrentMinisterContext(), error => error.status === 409)
  const context = await contextModule({ ...options, headers: { 'x-wf-church-id': other } }).getCurrentMinisterContext({ requireAdmin: true })
  assert.equal(context.role, 'admin')
  assert.equal(context.churchId, other)
  await assert.rejects(contextModule({ databaseError: { message: 'private' } }).getCurrentMinisterContext(), error => error.status === 503 && !error.message.includes('private'))
})

test('global profile API accepts only self-edited name and rejects role, tenant and foreign identities', async () => {
  const calls = []
  const chain = {
    update: value => { calls.push(['update', value]); return chain },
    eq: (...args) => { calls.push(['eq', ...args]); return chain }, select: () => chain,
    maybeSingle: async () => ({ data: { user_id: 'actor', name: 'Ana', avatar_url: null }, error: null }),
  }
  const api = load('app/api/profile/route.ts', {
    '@/lib/auth/request-origin': requestOrigin,
    '@/lib/auth/identity': { getAuthenticatedIdentity: async () => ({ id: 'actor' }) },
    '@/lib/auth-context': { getImpersonatedChurchId: async () => null },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: table => { assert.equal(table, 'user_profiles'); return chain } }) },
  })
  assert.equal((await api.PATCH(changeRequest({ name: ' Ana ' }))).status, 200)
  assert.equal(calls[0][1].name, 'Ana')
  assert.deepEqual(calls[1], ['eq', 'user_id', 'actor'])
  const before = calls.length
  for (const body of [{ name: 'Ana', role: 'admin' }, { name: 'Ana', user_id: 'other' }, { name: 'Ana', church_id: other }, {}, { name: ' ' }]) {
    assert.equal((await api.PATCH(changeRequest(body))).status, 400)
  }
  assert.equal((await api.PATCH(changeRequest({ name: 'Ana' }, 'https://untrusted.example'))).status, 403)
  assert.equal(calls.length, before)
})

test('mutation origin uses public configuration behind proxies without trusting forwarded headers', () => {
  const { isTrustedMutationOrigin } = requestOrigin
  const req = new Request('http://0.0.0.0:3001/api/profile', { headers: { Origin: 'http://127.0.0.1:3001' } })
  assert.equal(isTrustedMutationOrigin(req, 'http://127.0.0.1:3001'), true)
  assert.equal(isTrustedMutationOrigin(req, 'https://worship.example.com'), false)
  req.headers.set('x-forwarded-host', '127.0.0.1:3001')
  req.headers.set('host', '127.0.0.1:3001')
  assert.equal(isTrustedMutationOrigin(req, 'https://worship.example.com'), false)
  for (const config of ['invalid', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?key=1', 'file:///']) {
    assert.equal(isTrustedMutationOrigin(req, config), false)
  }
  req.headers.delete('origin')
  assert.equal(isTrustedMutationOrigin(req, 'http://127.0.0.1:3001'), false)
})

test('church preference is identity-bound, bounded and never an authorization grant', () => {
  const { readChurchPreference, churchPreferenceValue } = contextSelection
  assert.equal(readChurchPreference(churchPreferenceValue('actor', church), 'actor'), church)
  assert.equal(readChurchPreference(churchPreferenceValue('other-actor', church), 'actor'), null)
  for (const value of ['invalid', 'null', '{}', 'x'.repeat(501), JSON.stringify({ userId: 'actor', churchId: 'not-a-uuid' })]) {
    assert.equal(readChurchPreference(value, 'actor'), null)
  }
  const second = { ...member, id: 'second', church_id: other, role: 'admin' }
  assert.equal(resolveMembership([member, second], null, other).membership.role, 'admin')
  assert.deepEqual(resolveMembership([member], null, other), { kind: 'selected', membership: member })
  assert.deepEqual(resolveMembership([member], other, church), { kind: 'unavailable' })
})

test('server resumes only a still-accessible preference, and explicit destination takes precedence', async () => {
  const second = { ...member, id: 'second', church_id: other, role: 'admin' }
  const options = { memberships: [member, second], churches: [
    { id: church, name: 'A', status: 'active' }, { id: other, name: 'B', status: 'active' },
  ], lastChurch: other }
  const chosen = await contextModule(options).getCurrentMinisterContext()
  assert.equal(chosen.churchId, other)
  assert.equal(chosen.accessibleChurchCount, 2)
  assert.equal((await contextModule({ ...options, headers: { 'x-wf-church-id': church } }).getCurrentMinisterContext()).churchId, church)
  assert.equal((await contextModule({ ...options, cookie: contextSelection.churchPreferenceValue('actor', church) }).getCurrentMinisterContext()).churchId, church)
})

function selectionRoute(options = {}) {
  const writes = [], savedCookies = []
  const chain = {
    update: data => { writes.push(data); return chain },
    eq: (column, value) => { assert.equal(column, 'user_id'); assert.equal(value, 'actor'); return chain },
    select: () => chain,
    maybeSingle: async () => ({ data: options.missingProfile ? null : { user_id: 'actor' }, error: options.writeError ?? null }),
  }
  const api = load('app/api/context/route.ts', {
    'next/headers': { cookies: async () => ({ set: (...args) => savedCookies.push(args) }) },
    '@/lib/auth-context': { AuthContextError, getOwnMemberships: async () => options.memberships ?? [member], getImpersonatedChurchId: async () => options.support ? church : null },
    '@/lib/auth/identity': { getAuthenticatedIdentity: async () => options.anonymous ? null : { id: 'actor' } },
    '@/lib/auth/membership': { resolveMembership },
    '@/lib/auth/context-selection': contextSelection,
    '@/lib/auth/request-origin': requestOrigin,
    '@/lib/routes': { ROUTES },
    '@/lib/supabase/admin': { createAdminClient: () => ({ from: table => { assert.equal(table, 'user_profiles'); return chain } }) },
  })
  return { api, writes, savedCookies }
}

test('selection persists only the authenticated person\'s preference and sets an HttpOnly cookie', async () => {
  const { api, writes, savedCookies } = selectionRoute()
  const response = await api.POST(changeRequest({ churchId: church }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).redirectTo, ROUTES.SONGS)
  assert.equal(writes[0].last_church_id, church)
  assert.equal(savedCookies[0][0], contextSelection.CHURCH_CONTEXT_COOKIE)
  assert.equal(contextSelection.readChurchPreference(savedCookies[0][1], 'actor'), church)
  assert.equal(savedCookies[0][2].httpOnly, true)
  assert.equal(savedCookies[0][2].sameSite, 'lax')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('selection rejects inaccessible, suspended, forged and support requests without cookie changes', async () => {
  for (const [body, options, expected] of [
    [{ churchId: other }, {}, 403],
    [{ churchId: church }, { memberships: [{ ...member, access_state: 'suspended' }] }, 403],
    [{ churchId: church, userId: 'other-person' }, {}, 400],
    [{ churchId: church }, { support: true }, 409],
    [{ churchId: church }, { anonymous: true }, 401],
  ]) {
    const { api, writes, savedCookies } = selectionRoute(options)
    assert.equal((await api.POST(changeRequest(body))).status, expected)
    assert.equal(writes.length, 0)
    assert.equal(savedCookies.length, 0)
  }
  const { api, savedCookies } = selectionRoute({ writeError: { message: 'private' } })
  assert.equal((await api.POST(changeRequest({ churchId: church }))).status, 503)
  assert.equal(savedCookies.length, 0)
})

test('churchFetch captures its explicit church, preserves headers and rejects external destinations', async () => {
  const calls = []
  const client = load('lib/auth/client-context.ts', {
    '@/lib/supabase/client': { createClient: () => assert.fail('Not used in this test') },
    '@/lib/routes': { ROUTES }, '@/lib/auth/context-selection': contextSelection,
    fetch: async (...args) => { calls.push(args); return new Response('{}') },
  })
  await client.churchFetch(church, '/api/repertoire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(calls[0][1].headers.get('x-wf-church-id'), church)
  assert.equal(calls[0][1].headers.get('Content-Type'), 'application/json')
  assert.equal(calls[0][1].cache, 'no-store')
  assert.throws(() => client.churchFetch(other, 'https://untrusted.example/api/repertoire'))
  assert.throws(() => client.churchFetch('invalid', '/api/repertoire'))
  assert.equal(calls.length, 1)
})

test('selectedChurchFetch resolves validated context and pins it on the operational request', async () => {
  const calls = []
  const client = load('lib/auth/client-context.ts', {
    '@/lib/supabase/client': { createClient: () => assert.fail('Not used') },
    '@/lib/routes': { ROUTES }, '@/lib/auth/context-selection': contextSelection,
    window: { location: { pathname: '/schedule', search: '' } },
    fetch: async (url, init) => {
      calls.push([url, init])
      return url === '/api/context'
        ? new Response(JSON.stringify({ context: { churchId: church } }), { status: 200 })
        : new Response('{}', { status: 200 })
    },
  })
  await client.selectedChurchFetch('/api/schedule/current', { method: 'GET' })
  assert.equal(calls[0][0], '/api/context')
  assert.equal(calls[1][0], '/api/schedule/current')
  assert.equal(calls[1][1].headers.get('x-wf-church-id'), church)
  assert.equal(calls[1][1].cache, 'no-store')
})

test('late context errors cannot redirect an abandoned page after church selection', async () => {
  const redirects = []
  const location = { pathname: '/songs', search: '', replace: destination => redirects.push(destination) }
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const client = load('lib/auth/client-context.ts', {
    '@/lib/supabase/client': { createClient: () => assert.fail('Not used') },
    '@/lib/routes': { ROUTES }, '@/lib/auth/context-selection': contextSelection,
    window: { location }, fetch: () => pending,
  })
  const request = client.loadChurchContext()
  location.pathname = '/auth/select-church'
  finish(new Response('{}', { status: 403 }))
  await assert.rejects(request)
  assert.deepEqual(redirects, [])
})

test('Google Calendar OAuth callback is bound to the initiating identity, membership and church', async () => {
  const state = { nonce: 'one-time-state', userId: 'actor', ministerId: 'membership', churchId: church }
  const calls = { context: [], exchanged: 0, saved: [], synced: [] }
  const callback = load('app/api/google-calendar/callback/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: JSON.stringify(state) }) }) },
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async options => {
        calls.context.push(options)
        return { userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: false }
      },
    },
    '@/lib/google-calendar/client': {
      exchangeCodeForTokens: async () => { calls.exchanged++; return { access_token: 'local-test-only', refresh_token: 'local-test-only' } },
      saveTokensForUser: async (...args) => calls.saved.push(args),
      enableChurchSync: async (...args) => calls.synced.push(args),
    },
    '@/lib/google-calendar/reconcile': { reconcileMinisterCalendar: async () => ({ skipped: 'not_connected' }) },
  })
  const response = await callback.GET(new Request(`http://localhost/api/google-calendar/callback?code=opaque&state=${state.nonce}`))
  assert.equal(response.status, 307)
  const destination = new URL(response.headers.get('location'))
  assert.equal(destination.pathname, '/profile')
  assert.equal(destination.searchParams.get('churchId'), church)
  assert.equal(destination.searchParams.get('google_calendar'), 'connected')
  assert.deepEqual(calls.context, [{ churchId: church }])
  assert.equal(calls.exchanged, 1)
  assert.equal(calls.saved[0][0], 'actor')
  assert.deepEqual(calls.synced, [['actor', church, 'membership']])

  const mismatch = load('app/api/google-calendar/callback/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: JSON.stringify(state) }) }) },
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async () => ({ userId: 'different-identity', ministerId: 'membership', churchId: church, isImpersonating: false }),
    },
    '@/lib/google-calendar/client': {
      exchangeCodeForTokens: async () => assert.fail('Must reject the identity mismatch before exchanging tokens'),
      saveTokensForUser: async () => assert.fail('Must not save tokens for a different identity'),
      enableChurchSync: async () => assert.fail('Must not enable sync for a different identity'),
    },
    '@/lib/google-calendar/reconcile': { reconcileMinisterCalendar: async () => assert.fail('Must not reconcile') },
  })
  const rejected = await mismatch.GET(new Request(`http://localhost/api/google-calendar/callback?code=opaque&state=${state.nonce}`))
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('google_calendar'), 'error')
})

test('Google Calendar church sync requires a personal credential and never trusts a body church', async () => {
  const context = { userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: false }
  const calls = { context: [], credential: [], enabled: [], disabled: [], reconciled: [] }
  const api = load('app/api/google-calendar/sync-selection/route.ts', {
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async options => { calls.context.push(options); return context },
    },
    '@/lib/google-calendar/client': {
      hasCredentialForUser: async userId => { calls.credential.push(userId); return true },
      enableChurchSync: async (...args) => calls.enabled.push(args),
    },
    '@/lib/google-calendar/reconcile': {
      disconnectChurchSync: async (...args) => calls.disabled.push(args),
      reconcileMinisterCalendar: async (...args) => calls.reconciled.push(args),
    },
  })
  const request = body => new Request('http://localhost/api/google-calendar/sync-selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wf-church-id': church },
    body: JSON.stringify(body),
  })

  const enabled = await api.POST(request({ enabled: true, churchId: other }))
  assert.equal(enabled.status, 200)
  assert.deepEqual(calls.context, [{ churchId: church }])
  assert.deepEqual(calls.credential, ['actor'])
  assert.deepEqual(calls.enabled, [['actor', church, 'membership']])
  assert.deepEqual(calls.reconciled, [['membership']])

  const disabled = await api.POST(request({ enabled: false }))
  assert.equal(disabled.status, 200)
  assert.deepEqual(calls.disabled, [['membership']])

  const missingCredential = load('app/api/google-calendar/sync-selection/route.ts', {
    '@/lib/auth-context': { AuthContextError, getCurrentMinisterContext: async () => context },
    '@/lib/google-calendar/client': {
      hasCredentialForUser: async () => false,
      enableChurchSync: async () => assert.fail('Must not enable without a credential'),
    },
    '@/lib/google-calendar/reconcile': {
      disconnectChurchSync: async () => assert.fail('Must not disable'),
      reconcileMinisterCalendar: async () => assert.fail('Must not reconcile'),
    },
  })
  assert.equal((await missingCredential.POST(request({ enabled: true }))).status, 409)
})

test('Google Calendar disconnect separates account revocation from one church', async () => {
  const calls = { church: [], account: [], context: [] }
  const api = load('app/api/google-calendar/disconnect/route.ts', {
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async options => {
        calls.context.push(options)
        return { userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: false }
      },
    },
    '@/lib/google-calendar/reconcile': {
      disconnectChurchSync: async (...args) => calls.church.push(args),
      disconnectUserAccount: async (...args) => calls.account.push(args),
    },
  })
  const request = body => new Request('http://localhost/api/google-calendar/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wf-church-id': church },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  assert.equal((await api.POST(request({ scope: 'church' }))).status, 200)
  assert.deepEqual(calls.church, [['membership']])
  assert.deepEqual(calls.account, [])

  assert.equal((await api.POST(request())).status, 200)
  assert.deepEqual(calls.account, [['actor']])
  assert.deepEqual(calls.context, [{ churchId: church }, { churchId: church }])

  const support = load('app/api/google-calendar/disconnect/route.ts', {
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async () => ({ userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: true }),
    },
    '@/lib/google-calendar/reconcile': {
      disconnectChurchSync: async () => assert.fail('Support must not stop sync'),
      disconnectUserAccount: async () => assert.fail('Support must not revoke the account'),
    },
  })
  assert.equal((await support.POST(request({ scope: 'account' }))).status, 403)
})

test('preferences separate the personal global pause from local church settings', async () => {
  const calls = []
  const admin = {
    from(table) {
      const builder = {
        update(values) { calls.push({ table, values }); return builder },
        eq() { return builder },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve) },
      }
      return builder
    },
  }
  const api = load('app/api/preferences/route.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async options => {
        assert.deepEqual(options, { churchId: church })
        return { userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: false }
      },
    },
    '@/lib/google-calendar/reconcile': { reconcileMinisterCalendar: async () => {} },
  })
  const request = body => new Request('http://localhost/api/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-wf-church-id': church },
    body: JSON.stringify(body),
  })

  assert.equal((await api.PATCH(request({
    email_reminders_enabled: false,
    optional_notifications_paused: true,
  }))).status, 200)
  assert.deepEqual(calls.map(call => call.table), ['ministers', 'user_profiles'])
  assert.deepEqual(calls[0].values, { email_reminders_enabled: false })
  assert.equal(calls[1].values.optional_notifications_paused, true)
  assert.equal(typeof calls[1].values.updated_at, 'string')

  calls.length = 0
  assert.equal((await api.PATCH(request({ optional_notifications_paused: false }))).status, 200)
  assert.deepEqual(calls.map(call => call.table), ['user_profiles'])

  assert.equal((await api.PATCH(request({ optional_notifications_paused: 'yes' }))).status, 400)

  const support = load('app/api/preferences/route.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => assert.fail('Support must not write preferences') },
    '@/lib/auth-context': {
      AuthContextError,
      getCurrentMinisterContext: async () => ({ userId: 'actor', ministerId: 'membership', churchId: church, isImpersonating: true }),
    },
    '@/lib/google-calendar/reconcile': { reconcileMinisterCalendar: async () => assert.fail('Support must not reconcile') },
  })
  assert.equal((await support.PATCH(request({ optional_notifications_paused: true }))).status, 403)
})
