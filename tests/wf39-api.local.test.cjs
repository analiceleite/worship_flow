// WF-39 (API layer): a church A administrator must not read or change church B through the HTTP routes
// that use the service role (which bypasses RLS). Runs against the isolated local stack:
// the local Supabase (Compose) plus a Next dev server started with local env (APP_URL, default 127.0.0.1:3002).
// Fixtures are committed for the duration of the test and removed in `finally`.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, before, after } = require('node:test')
const { Client } = require('pg')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.WF39_APP_URL || 'http://127.0.0.1:3002'

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Use the isolated local runtime; refusing non-local integration tests.')
}
if (!APP_URL.startsWith('http://127.0.0.1:') && !APP_URL.startsWith('http://localhost:')) {
  throw new Error('Refusing a non-local application URL.')
}
const dbUrl = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (!(dbUrl.hostname === '127.0.0.1' && dbUrl.port === '54322') || dbUrl.pathname !== '/postgres') {
  throw new Error('Refusing non-local integration database')
}

const ids = {
  churchA: randomUUID(), churchB: randomUUID(),
  userA: randomUUID(), userB: randomUUID(),
  mA: randomUUID(), mB: randomUUID(),
  songA: randomUUID(), songB: randomUUID(),
  qA: randomUUID(), qB: randomUUID(),
  assignB: randomUUID(), rehearsalB: randomUUID(), repertoireB: randomUUID(),
}
const SECRET_B = 'Local Secreto B'
const TODAY = new Date().toISOString().slice(0, 10)
const emails = {
  a: `wf39-admin-a-${ids.userA}@wf39.local.test`,
  b: `wf39-admin-b-${ids.userB}@wf39.local.test`,
}
const password = `Wf39-${randomUUID()}`
const createdUsers = []
let db
let session
let sessionB

async function admin(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...options.headers },
  })
  return res
}

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(res.status, 200, `sign-in failed for ${email}`)
  return res.json()
}

function sessionCookie(value) {
  // @supabase/ssr stores the session as "base64-" + base64url(JSON) in sb-<host label>-auth-token.
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `sb-127-auth-token=base64-${encoded}`
}

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, text, json, setCookie: res.headers.get('set-cookie') }
}

async function state() {
  const quarters = await db.query('SELECT id, is_published FROM public.schedule_quarters WHERE id = ANY($1)', [[ids.qA, ids.qB]])
  const ministers = await db.query('SELECT id, access_state FROM public.ministers WHERE id = ANY($1)', [[ids.mA, ids.mB]])
  const songs = await db.query('SELECT id, minister_id FROM public.songs WHERE id = ANY($1)', [[ids.songA, ids.songB]])
  const controls = await db.query('SELECT count(*)::int AS n FROM public.schedule_event_controls WHERE church_id = $1', [ids.churchB])
  return {
    quarters: Object.fromEntries(quarters.rows.map(r => [r.id, r.is_published])),
    ministers: Object.fromEntries(ministers.rows.map(r => [r.id, r.access_state])),
    songs: Object.fromEntries(songs.rows.map(r => [r.id, r.minister_id])),
    controlsInB: controls.rows[0].n,
  }
}

before(async () => {
  try {
    const probe = await fetch(`${APP_URL}/api/context`)
    assert.ok(probe.status === 401 || probe.status === 200, 'application is not responding')
  } catch (error) {
    throw new Error(`Start the local app first (next dev on ${APP_URL}): ${error.message}`)
  }
  db = new Client({ connectionString: dbUrl.toString() })
  await db.connect()

  for (const [id, email] of [[ids.userA, emails.a], [ids.userB, emails.b]]) {
    const res = await admin('/auth/v1/admin/users', {
      method: 'POST', body: JSON.stringify({ id, email, password, email_confirm: true }),
    })
    assert.ok(res.status === 200 || res.status === 201, `could not create test user (${res.status})`)
    createdUsers.push(id)
  }

  await db.query('INSERT INTO public.churches(id,name,slug,environment,email_mode,status) VALUES ($1,\'WF39 A\',$2,\'test\',\'disabled\',\'active\'),($3,\'WF39 B\',$4,\'test\',\'disabled\',\'active\')',
    [ids.churchA, `wf39-a-${ids.churchA}`, ids.churchB, `wf39-b-${ids.churchB}`])
  await db.query(`INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES
    ($1,$2,$3,'Admin A','a@wf39.local.test','admin','Voz','active'),
    ($4,$5,$6,'Admin B','b@wf39.local.test','admin','Voz','active')`,
  [ids.mA, ids.userA, ids.churchA, ids.mB, ids.userB, ids.churchB])
  await db.query(`INSERT INTO public.songs(id,title,artist,church_id,minister_id) VALUES
    ($1,'Música A','Artista',$2,$3),($4,'Música B','Artista',$5,$6)`,
  [ids.songA, ids.churchA, ids.mA, ids.songB, ids.churchB, ids.mB])
  await db.query(`INSERT INTO public.schedule_quarters(id,name,start_date,end_date,is_published,church_id) VALUES
    ($1,'Trimestre A',CURRENT_DATE,CURRENT_DATE+90,true,$2),($3,'Trimestre B',CURRENT_DATE,CURRENT_DATE+90,true,$4)`,
  [ids.qA, ids.churchA, ids.qB, ids.churchB])

  // Church B data that the attacks below must not read or change.
  const role = await db.query('SELECT id FROM public.schedule_roles ORDER BY display_order NULLS LAST LIMIT 1')
  await db.query('UPDATE public.churches SET timezone = $2 WHERE id = $1', [ids.churchB, 'America/Manaus'])
  await db.query(`INSERT INTO public.schedule_assignments(id,quarter_id,minister_id,role_id,event_date,event_type,church_id)
    VALUES ($1,$2,$3,$4,CURRENT_DATE,'sunday',$5)`, [ids.assignB, ids.qB, ids.mB, role.rows[0].id, ids.churchB])
  await db.query(`INSERT INTO public.schedule_rehearsals(id,quarter_id,event_date,event_type,rehearsal_place,church_id)
    VALUES ($1,$2,CURRENT_DATE,'sunday',$3,$4)`, [ids.rehearsalB, ids.qB, SECRET_B, ids.churchB])
  await db.query("SELECT set_config('wf07.writing','on',false)")
  await db.query(`INSERT INTO public.repertoire(id,minister_id,song_id,event_date,order_index,church_id)
    VALUES ($1,$2,$3,CURRENT_DATE,1,$4)`, [ids.repertoireB, ids.mB, ids.songB, ids.churchB])
  await db.query("SELECT set_config('wf07.writing','off',false)")

  await db.query(`INSERT INTO public.user_profiles(user_id,name) VALUES ($1,'Perfil A'),($2,'Perfil B')`, [ids.userA, ids.userB])

  session = await signIn(emails.a)
  sessionB = await signIn(emails.b)
})

// Everything that belongs to church B. Attacks from church A must leave this exactly as it was.
async function snapshotB() {
  const q = (sql) => db.query(sql, [ids.churchB]).then(r => r.rows)
  return JSON.stringify({
    church: await q('SELECT id, name, timezone, status FROM public.churches WHERE id = $1'),
    ministers: await q(`SELECT id, name, role, access_state, email_reminders_enabled, calendar_alarm_offsets_minutes,
      email_reminder_offsets_minutes FROM public.ministers WHERE church_id = $1 ORDER BY id`),
    profileB: (await db.query('SELECT name, optional_notifications_paused FROM public.user_profiles WHERE user_id = $1', [ids.userB])).rows,
    googleSync: await q('SELECT user_id, church_id FROM public.google_calendar_church_sync WHERE church_id = $1 ORDER BY user_id'),
    platformChurch: await q('SELECT name, status, plan, environment, email_mode FROM public.churches WHERE id = $1'),
    songs: await q('SELECT id, title, minister_id FROM public.songs WHERE church_id = $1 ORDER BY id'),
    quarters: await q('SELECT id, is_published FROM public.schedule_quarters WHERE church_id = $1 ORDER BY id'),
    assignments: await q('SELECT id, minister_id, role_id, event_date FROM public.schedule_assignments WHERE church_id = $1 ORDER BY id'),
    rehearsals: await q('SELECT id, rehearsal_place FROM public.schedule_rehearsals WHERE church_id = $1 ORDER BY id'),
    controls: await q('SELECT id, leader_minister_id FROM public.schedule_event_controls WHERE church_id = $1 ORDER BY id'),
    repertoire: await q('SELECT id, minister_id, song_id FROM public.repertoire WHERE church_id = $1 ORDER BY id'),
    notifications: await q('SELECT count(*)::int AS n FROM public.schedule_email_notifications WHERE church_id = $1'),
  })
}
const baselineB = { value: null }
test('WF-39 API: snapshot of church B taken before attacks', async () => {
  baselineB.value = await snapshotB()
  assert.ok(baselineB.value.includes(SECRET_B), 'fixture rehearsal must exist before the attacks')
})

after(async () => {
  if (db) {
    // Remove fixtures without firing triggers that write notifications or calendar state.
    await db.query("SET session_replication_role = 'replica'")
    for (const table of ['schedule_event_controls', 'schedule_assignments', 'schedule_rehearsals', 'schedule_notifications',
      'schedule_email_notifications', 'repertoire', 'songs', 'special_events', 'schedule_quarters', 'ministers']) {
      await db.query(`DELETE FROM public.${table} WHERE church_id = ANY($1)`, [[ids.churchA, ids.churchB]])
    }
    await db.query('DELETE FROM public.churches WHERE id = ANY($1)', [[ids.churchA, ids.churchB]])
  }
  if (db) {
    await db.query("SET session_replication_role = 'replica'")
    await db.query('DELETE FROM public.user_profiles WHERE user_id = ANY($1)', [createdUsers])
    await db.query('DELETE FROM public.ministers WHERE user_id = ANY($1)', [createdUsers])
    await db.end()
  }
  for (const id of createdUsers) {
    const res = await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
    if (res.status >= 300) console.error(`WF-39 cleanup: could not delete test user ${id} (${res.status})`)
  }
})

test('WF-39 API control: admin A can read its own quarter (harness works)', async () => {
  const cookie = sessionCookie(session)
  const res = await call('GET', `/api/schedule/quarters/${ids.qA}/assignments`, { cookie })
  assert.equal(res.status, 200, res.text.slice(0, 300))
})

test('WF-39 API control: admin B can read church B quarter (proves the data exists and is served to its owner)', async () => {
  const res = await call('GET', `/api/schedule/quarters/${ids.qB}/assignments`, { cookie: sessionCookie(sessionB) })
  assert.equal(res.status, 200, res.text.slice(0, 300))
  assert.ok(res.text.includes('Trimestre B'))
})

test('WF-39 API: admin A cannot read church B quarter assignments', async () => {
  const cookie = sessionCookie(session)
  const res = await call('GET', `/api/schedule/quarters/${ids.qB}/assignments`, { cookie })
  assert.ok(res.status >= 400 || !res.text.includes('Trimestre B'), `leaked church B data (status ${res.status})`)
})

test('WF-39 API: admin A cannot delete or unpublish church B quarter', async () => {
  const before = await state()
  const cookie = sessionCookie(session)
  await call('DELETE', `/api/schedule/quarters/${ids.qB}`, { cookie })
  await call('PATCH', `/api/schedule/quarters/${ids.qB}/publish`, { cookie, body: { is_published: false } })
  const after = await state()
  assert.equal(after.quarters[ids.qB], true, 'quarter B must remain published')
  assert.ok(before.quarters[ids.qB] !== undefined, 'quarter B must still exist')
  assert.equal((await db.query('SELECT 1 FROM public.schedule_quarters WHERE id=$1', [ids.qB])).rowCount, 1)
})

test('WF-39 API: admin A cannot suspend or delete church B minister', async () => {
  const cookie = sessionCookie(session)
  await call('PATCH', `/api/ministers/${ids.mB}/access`, { cookie, body: { state: 'suspended' } })
  await call('DELETE', `/api/ministers/${ids.mB}`, { cookie })
  const after = await state()
  assert.equal(after.ministers[ids.mB], 'active', 'minister B must remain active')
  assert.equal((await db.query('SELECT 1 FROM public.ministers WHERE id=$1', [ids.mB])).rowCount, 1)
})

test('WF-39 API: admin A cannot transfer church B songs', async () => {
  const cookie = sessionCookie(session)
  await call('POST', '/api/songs/transfer', { cookie, body: { from_minister_id: ids.mB, to_minister_id: ids.mA } })
  const after = await state()
  assert.equal(after.songs[ids.songB], ids.mB, 'song B must keep its owner')
})

test('WF-39 API: admin A cannot read a church B song cipher', async () => {
  const cookie = sessionCookie(session)
  const res = await call('GET', `/api/repertoire/cifra?songId=${ids.songB}`, { cookie })
  assert.ok(res.status >= 400 || !res.text.includes('Música B') || res.json?.song == null,
    `leaked church B song (status ${res.status})`)
})

test('WF-39 API: admin A cannot control events of church B', async () => {
  const cookie = sessionCookie(session)
  const today = new Date().toISOString().slice(0, 10)
  await call('PATCH', '/api/schedule/event-control', { cookie, body: {
    quarter_id: ids.qB, event_date: today, event_type: 'sunday', leader_minister_id: ids.mA,
  } })
  const after = await state()
  assert.equal(after.controlsInB, 0, 'no control rows may be created in church B')
})

test('WF-39 API: a church header for a church the admin does not belong to is refused', async () => {
  const cookie = sessionCookie(session)
  const res = await call('GET', `/api/schedule/quarters/${ids.qB}/assignments`, {
    cookie, headers: { 'x-wf-church-id': ids.churchB },
  })
  assert.ok(res.status >= 400, `context spoofing must be refused (status ${res.status})`)
  assert.ok(!res.text.includes('Trimestre B'))
})

test('WF-39 API control: admin B reads its own rehearsal (fixture is served to its owner)', async () => {
  const res = await call('GET', `/api/schedule/rehearsal?quarter_id=${ids.qB}&event_date=${TODAY}&event_type=sunday`,
    { cookie: sessionCookie(sessionB) })
  assert.equal(res.status, 200, res.text.slice(0, 300))
  assert.ok(res.text.includes(SECRET_B), 'owner B must see its rehearsal')
})

test('WF-39 API: admin A cannot read church B rehearsal', async () => {
  const res = await call('GET', `/api/schedule/rehearsal?quarter_id=${ids.qB}&event_date=${TODAY}&event_type=sunday`,
    { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes(SECRET_B), `leaked church B rehearsal (status ${res.status})`)
})

test('WF-39 API: admin A cannot change church B rehearsal by quarter id', async () => {
  const res = await call('PATCH', '/api/schedule/rehearsal', { cookie: sessionCookie(session), body: {
    quarter_id: ids.qB, event_date: TODAY, event_type: 'sunday', rehearsal_place: 'Invadido',
  } })
  assert.ok(res.status >= 400 || !res.text.includes('Invadido'), 'the forged place must not be echoed back as saved')
  assert.equal((await db.query('SELECT rehearsal_place FROM public.schedule_rehearsals WHERE id=$1', [ids.rehearsalB])).rows[0].rehearsal_place, SECRET_B)
})

test('WF-39 API: admin A cannot reassign church B assignment by id', async () => {
  await call('PATCH', '/api/schedule/assignment', { cookie: sessionCookie(session), body: { id: ids.assignB, minister_id: ids.mA } })
  const row = await db.query('SELECT minister_id FROM public.schedule_assignments WHERE id=$1', [ids.assignB])
  assert.equal(row.rows[0].minister_id, ids.mB)
})

test('WF-39 API: admin A cannot create an assignment in church B through quarter id', async () => {
  const role = await db.query('SELECT id FROM public.schedule_roles ORDER BY display_order NULLS LAST LIMIT 1')
  await call('PATCH', '/api/schedule/assignment', { cookie: sessionCookie(session), body: {
    quarter_id: ids.qB, role_id: role.rows[0].id, event_date: TODAY, event_type: 'thursday', minister_id: ids.mA,
  } })
  const count = await db.query('SELECT count(*)::int AS n FROM public.schedule_assignments WHERE church_id=$1 AND event_type=\'thursday\'', [ids.churchB])
  assert.equal(count.rows[0].n, 0)
})

test('WF-39 API: admin A cannot apply an import to church B assignments', async () => {
  await call('POST', `/api/schedule/quarters/${ids.qB}/import/apply`, { cookie: sessionCookie(session), body: {
    items: [{ assignment_id: ids.assignB, minister_id: ids.mA }],
  } })
  const row = await db.query('SELECT minister_id FROM public.schedule_assignments WHERE id=$1', [ids.assignB])
  assert.equal(row.rows[0].minister_id, ids.mB)
})

test('WF-39 API: admin A admin analytics does not expose church B quarter', async () => {
  const res = await call('GET', `/api/schedule/admin/analytics?quarter_id=${ids.qB}`, { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Trimestre B') && !res.text.includes(SECRET_B), `leaked church B (status ${res.status})`)
})

test('WF-39 API: current schedule for admin A never shows church B', async () => {
  const res = await call('GET', '/api/schedule/current', { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Trimestre B') && !res.text.includes(SECRET_B), `leaked church B (status ${res.status})`)
})

test('WF-39 API: minister search for admin A never returns church B people', async () => {
  const res = await call('GET', '/api/ministers/search?query=Admin%20B', { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Admin B'), `leaked church B minister (status ${res.status})`)
})

test('WF-39 API: admin A cannot add church B song to its repertoire', async () => {
  const res = await call('POST', '/api/repertoire', { cookie: sessionCookie(session), body: {
    date: TODAY, eventName: 'Culto WF39', expectedRevision: '0', command: { action: 'add', songId: ids.songB },
  } })
  assert.ok(res.status >= 400, `must be refused (status ${res.status})`)
  assert.ok(!res.text.includes('Música B'), 'church B song must not be returned')
})

test('WF-39 API: repertoire read for admin A does not show church B items', async () => {
  const res = await call('GET', `/api/repertoire?date=${TODAY}&eventName=Culto%20WF39`, { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Música B'), `leaked church B repertoire (status ${res.status})`)
})

test('WF-39 API: schedule notifications cannot be enqueued without the cron secret', async () => {
  const res = await call('POST', '/api/notifications/schedule/enqueue-published', { body: { quarter_id: ids.qB } })
  assert.ok(res.status === 401 || res.status === 403, `unauthenticated call must be refused (status ${res.status})`)
})

test('WF-39 API: admin A cannot list platform churches', async () => {
  const res = await call('GET', '/api/platform/churches', { cookie: sessionCookie(session) })
  assert.ok(res.status >= 400, `platform route must be refused (status ${res.status})`)
  assert.ok(!res.text.includes('WF39 B'))
})

test('WF-39 API: admin A cannot impersonate church B', async () => {
  const res = await call('POST', '/api/platform/impersonation', { cookie: sessionCookie(session), body: { church_id: ids.churchB } })
  assert.ok(res.status >= 400, `impersonation must be refused (status ${res.status})`)
  assert.equal(res.setCookie, null, 'refused impersonation must not set a cookie')
})

test('WF-39 API: church settings from admin A only change church A', async () => {
  const res = await call('PATCH', '/api/church/settings', { cookie: sessionCookie(session), body: { timezone: 'Europe/Lisbon' } })
  assert.ok(res.status === 200 || res.status >= 400, `unexpected status ${res.status}`)
  const tz = await db.query('SELECT timezone FROM public.churches WHERE id=$1', [ids.churchB])
  assert.equal(tz.rows[0].timezone, 'America/Manaus')
})

test('WF-39 API: admin A cannot create a quarter for church B by sending its church id', async () => {
  const res = await call('POST', '/api/schedule/quarters', { cookie: sessionCookie(session), body: {
    name: 'Trimestre Invadido', church_id: ids.churchB, start_date: TODAY, end_date: TODAY,
  } })
  const leaked = await db.query("SELECT 1 FROM public.schedule_quarters WHERE church_id=$1 AND name='Trimestre Invadido'", [ids.churchB])
  assert.equal(leaked.rowCount, 0, `quarter created in church B (status ${res.status})`)
})

test('WF-39 API: quarter import preview for church B is refused to admin A', async () => {
  const res = await call('POST', `/api/schedule/quarters/${ids.qB}/import/preview`, { cookie: sessionCookie(session), body: {
    rows: [{ assignment_id: ids.assignB, minister_name: 'Admin A' }],
  } })
  assert.ok(res.status >= 400 || !res.text.includes('Trimestre B'), `leaked church B (status ${res.status})`)
  assert.ok(!res.text.includes(SECRET_B))
})

test('WF-39 API: admin A cannot rename or change plan of church B through the platform route', async () => {
  const res = await call('PATCH', `/api/platform/churches/${ids.churchB}`, { cookie: sessionCookie(session), body: { name: 'Invadida', plan: 'enterprise' } })
  assert.ok(res.status >= 400, `platform route must be refused (status ${res.status})`)
})

test('WF-39 API: admin A cannot connect Google Calendar sync for church B', async () => {
  const res = await call('GET', `/api/google-calendar/connect?churchId=${ids.churchB}`, { cookie: sessionCookie(session) })
  const sync = await db.query('SELECT 1 FROM public.google_calendar_church_sync WHERE church_id=$1 AND user_id=$2', [ids.churchB, ids.userA])
  assert.equal(sync.rowCount, 0, 'no sync row may exist for admin A in church B')
})

test('WF-39 API: sync selection from admin A never touches church B', async () => {
  await call('POST', '/api/google-calendar/sync-selection', { cookie: sessionCookie(session), body: { enabled: true, church_id: ids.churchB } })
  const sync = await db.query('SELECT 1 FROM public.google_calendar_church_sync WHERE church_id=$1', [ids.churchB])
  assert.equal(sync.rowCount, 0)
})

test('WF-39 API: preferences from admin A never change the minister of church B', async () => {
  const res = await call('PATCH', '/api/preferences', { cookie: sessionCookie(session), body: {
    optional_notifications_paused: true, ministerId: ids.mB,
  } })
  assert.ok(res.status >= 400 || res.status === 200, `unexpected status ${res.status}`)
})

test('WF-39 API: profile update from admin A only changes admin A profile', async () => {
  const res = await call('PATCH', '/api/profile', { cookie: sessionCookie(session), body: { name: 'Invadido', user_id: ids.userB } })
  assert.ok(res.status === 200 || res.status >= 400, `unexpected status ${res.status}`)
  const b = await db.query('SELECT name FROM public.user_profiles WHERE user_id=$1', [ids.userB])
  assert.equal(b.rows[0].name, 'Perfil B')
})

test('WF-39 API: repertoire catalog for admin A never lists church B songs', async () => {
  const res = await call('GET', '/api/repertoire/catalog', { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Música B'), `leaked church B catalog (status ${res.status})`)
  assert.equal(res.status, 200, 'catalog must answer for admin A')
})

test('WF-39 API: admin A cannot read or change church B through youtube search (no church data)', async () => {
  const res = await call('GET', '/api/youtube/search?query=louvor', { cookie: sessionCookie(session) })
  assert.ok(!res.text.includes('Música B') && !res.text.includes('WF39 B'), `unexpected church data (status ${res.status})`)
})

test('WF-39 API: church B state is unchanged after every attack from church A', async () => {
  assert.equal(await snapshotB(), baselineB.value)
})
