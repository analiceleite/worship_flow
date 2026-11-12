// WF-46 (integration): password sign-in through POST /api/auth/login against the isolated local stack.
// Checks the session cookies the server sets, the generic failure answers, and the per-e-mail limit.
// Fixtures are unique per run and removed in `finally`. Requires the local app container on APP_URL.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, before, after } = require('node:test')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.WF46_APP_URL || 'http://127.0.0.1:3001'

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY || !SERVICE_KEY) {
  throw new Error('Use the isolated local runtime; refusing non-local integration tests.')
}
if (!APP_URL.startsWith('http://127.0.0.1:') && !APP_URL.startsWith('http://localhost:')) {
  throw new Error('Refusing a non-local application URL.')
}

const password = `Wf46-${randomUUID()}`
const confirmedEmail = `wf46-confirmed-${randomUUID()}@wf46.local.test`
const unconfirmedEmail = `wf46-unconfirmed-${randomUUID()}@wf46.local.test`
const limitedEmail = `wf46-limited-${randomUUID()}@wf46.local.test`
const createdUserIds = []

async function authAdmin(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...options,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...options.headers },
  })
  return response
}

async function createUser(email, confirmed) {
  const response = await authAdmin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: confirmed }),
  })
  assert.equal(response.status, 200, `fixture user create failed: ${response.status}`)
  const user = await response.json()
  createdUserIds.push(user.id)
  return user.id
}

async function login(email, secret) {
  return fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email, password: secret }),
    redirect: 'manual',
  })
}

before(async () => {
  await createUser(confirmedEmail, true)
  await createUser(unconfirmedEmail, false)
  await createUser(limitedEmail, true)
})

after(async () => {
  for (const id of createdUserIds) {
    await authAdmin(`/admin/users/${id}`, { method: 'DELETE' })
  }
})

test('a confirmed account signs in on the server and receives session cookies', async () => {
  const response = await login(confirmedEmail, password)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { emailConfirmed: true })

  const cookies = response.headers.getSetCookie().filter(cookie => /auth-token/.test(cookie))
  assert.ok(cookies.length > 0, 'the login response must set the Supabase session cookies')

  // The cookies are accepted by a server route: anything but 401 means the session was read.
  const cookieHeader = cookies.map(cookie => cookie.split(';')[0]).join('; ')
  const context = await fetch(`${APP_URL}/api/context`, { headers: { Cookie: cookieHeader, Origin: APP_URL }, cache: 'no-store' })
  assert.notEqual(context.status, 401)
})

test('wrong password and unconfirmed account get the same generic answer', async () => {
  const wrong = await login(confirmedEmail, `${password}-x`)
  const unconfirmed = await login(unconfirmedEmail, password)
  assert.equal(wrong.status, 401)
  assert.equal(unconfirmed.status, 401)
  assert.equal((await wrong.json()).error, (await unconfirmed.json()).error)
})

test('the per-e-mail limit blocks further attempts, even with the right password', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await login(limitedEmail, `wrong-${attempt}-${randomUUID()}`)
    assert.equal(response.status, 401)
  }
  const blocked = await login(limitedEmail, password)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store')
})

test('the route refuses a foreign origin before any sign-in attempt', async () => {
  const response = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.net' },
    body: JSON.stringify({ email: confirmedEmail, password }),
  })
  assert.equal(response.status, 403)
})
