const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')

// Public Compose development credentials only. Never load .env or accept a
// hosted database URL. Run explicitly with pnpm test:wf32:local.
const config = {
  host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres',
  password: 'worship-flow-compose-local-password', connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
}

test('WF32 database authorization, atomic imports, conflicts, leadership and durable publication', async () => {
  const db = new Client(config)
  await db.connect()
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'wf32.local.sql'), 'utf8').replace(/^\\set.*$/gm, '')
    await db.query(sql)
  } finally { await db.end() }
})

test('concurrent conflicting mutations cannot both commit; email claim has one owner', async () => {
  const db = new Client(config), first = new Client(config), second = new Client(config)
  await Promise.all([db.connect(), first.connect(), second.connect()])
  const c = randomUUID(), admin = randomUUID(), person = randomUUID(), q = randomUUID(), a = randomUUID(), b = randomUUID()
  let pending
  try {
    await db.query('BEGIN')
    await db.query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1,'WF32 concurrency',$2,'test','disabled')", [c, `wf32-concurrency-${c}`])
    await db.query("INSERT INTO public.ministers(id,church_id,name,role,access_state,email) VALUES($1,$3,'Admin','admin','active','admin@wf32.test'),($2,$3,'Person','minister','active','person@wf32.test')", [admin, person, c])
    const role = (await db.query("SELECT id FROM public.schedule_roles WHERE category<>'midia' LIMIT 1")).rows[0].id
    await db.query("INSERT INTO public.schedule_quarters(id,church_id,name,start_date,end_date,thursday_arrival_time,thursday_service_time,sunday_arrival_time,sunday_service_time) VALUES($1,$2,'WF32 concurrency','2026-01-01','2026-03-31','16:00','17:00','16:00','17:00')", [q,c])
    await db.query("INSERT INTO public.schedule_assignments(id,church_id,quarter_id,role_id,event_date,event_type) VALUES($1,$3,$4,$5,'2026-01-08','thursday'),($2,$3,$4,$5,'2026-01-08','sunday')", [a,b,c,q,role])
    await db.query('COMMIT')
    await Promise.all([first.query('BEGIN'), second.query('BEGIN')])
    await first.query("SELECT public.wf32_mutate_schedule($1,$2,'assignment',$3::jsonb)", [c,admin,JSON.stringify({ id:a, minister_id:person })])
    // Catch immediately so the pending rejection is never unhandled.
    pending = second.query("SELECT public.wf32_mutate_schedule($1,$2,'assignment',$3::jsonb)", [c,admin,JSON.stringify({ id:b, minister_id:person })])
      .then(() => ({ ok:true }), error => ({ ok:false, error }))
    let blocked = false
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      blocked = (await db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS blocked", [second.processID])).rows[0].blocked
      if (blocked) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(blocked, true, 'second mutation must wait for the first transaction')
    await first.query('COMMIT')
    const result = await pending
    assert.equal(result.ok, false)
    assert.match(result.error.message, /WF32_SCHEDULE_CONFLICT/)
    await second.query('ROLLBACK')
    assert.equal((await db.query('SELECT minister_id FROM public.schedule_assignments WHERE id=$1',[b])).rows[0].minister_id, null)
    await db.query("SELECT public.wf32_mutate_schedule($1,$2,'publish',$3::jsonb)", [c,admin,JSON.stringify({ quarter_id:q, is_published:true })])
    const email = (await db.query("SELECT id FROM public.schedule_email_notifications WHERE church_id=$1 AND notification_type='quarter_published'", [c])).rows[0].id
    const claims = await Promise.all([first.query('SELECT public.wf32_claim_email($1) AS claim',[email]),second.query('SELECT public.wf32_claim_email($1) AS claim',[email])])
    assert.deepEqual(claims.map(result => result.rows[0].claim).sort(), [1,null])
  } finally {
    await Promise.allSettled([first.query('ROLLBACK'),second.query('ROLLBACK')])
    if (pending) await pending
    try {
      await db.query('ROLLBACK')
      // Remove only this test's UUID-scoped fixtures; preserve all preexisting data.
      await db.query('BEGIN')
      await db.query("SELECT set_config('wf04.maintenance','on',true)")
      await db.query('DELETE FROM public.schedule_assignments WHERE church_id=$1',[c])
      await db.query('DELETE FROM public.schedule_email_notifications WHERE church_id=$1',[c])
      await db.query('DELETE FROM public.schedule_quarters WHERE church_id=$1',[c])
      await db.query('DELETE FROM public.ministers WHERE church_id=$1',[c])
      await db.query('DELETE FROM public.churches WHERE id=$1',[c])
      await db.query('COMMIT')
    } finally { await Promise.all([db.end(),first.end(),second.end()]) }
  }
})
