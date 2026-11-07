// Real PostgreSQL/RLS checks. Synthetic fixtures are rolled back, never deleted.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY) {
  throw new Error('Use the isolated local runtime; refusing non-local integration tests.')
}
const url = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (!((url.hostname === '127.0.0.1' && url.port === '54322') ||
    (process.env.LOCAL_DOCKER === 'true' && url.hostname === 'db' && url.port === '5432')) || url.pathname !== '/postgres') {
  throw new Error('Refusing non-local integration database')
}

test('WF-04 real state guards, RLS, profile projection and migration replay', async t => {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  const church = randomUUID(), other = randomUUID()
  const actor = randomUUID(), peer = randomUUID(), pending = randomUUID(), foreign = randomUUID()
  const query = (sql, values) => db.query(sql, values)
  async function rejects(sql, values, pattern) {
    await query('SAVEPOINT wf04_reject')
    try { await assert.rejects(query(sql, values), pattern) }
    finally { await query('ROLLBACK TO SAVEPOINT wf04_reject') }
  }
  async function asUser(user, fn) {
    await query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [user, JSON.stringify({ sub: user, role: 'authenticated' })])
    await query('SET LOCAL ROLE authenticated')
    try { await fn() } finally {
      await query('RESET ROLE')
      await query("SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)")
    }
  }
  await query('BEGIN')
  try {
    const ready = await query("SELECT to_regclass('public.wf04_legacy_cutover') AS ready")
    assert.ok(ready.rows[0].ready, 'Apply migration 038 only to the isolated local database before this test')
    const expansion = await query("SELECT to_regclass('public.google_calendar_credentials') AS credentials, to_regclass('public.google_calendar_church_sync') AS sync")
    assert.ok(expansion.rows[0].credentials, 'Apply migration 039 only to the isolated local database before this test')
    assert.ok(expansion.rows[0].sync, 'Apply migration 039 only to the isolated local database before this test')
    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES ($1::uuid,'WF04 local',$1::uuid::text,'test','disabled'),($2::uuid,'WF04 other',$2::uuid::text,'test','disabled')", [church, other])
    for (const [id, tenant, role, state] of [
      [actor, church, 'admin', 'active'], [peer, church, 'minister', 'active'],
      [pending, church, 'minister', 'pending'], [foreign, other, 'minister', 'active'],
    ]) {
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@wf04.local.test`])
      await query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,access_state) VALUES($1,$1,$2,'WF04 fixture',$3,'Voz',$4)", [id, tenant, role, state])
      await query("INSERT INTO public.user_profiles(user_id,name) VALUES($1,'WF04 pessoa')", [id])
    }
    await t.test('pending and suspended cannot read operational team; active cannot cross tenants', async () => {
      await asUser(pending, async () => {
        assert.equal((await query('SELECT id FROM public.ministers WHERE church_id=$1', [church])).rowCount, 0)
      })
      await asUser(peer, async () => {
        assert.equal((await query('SELECT id FROM public.ministers WHERE church_id=$1', [other])).rowCount, 0)
        assert.ok((await query('SELECT id FROM public.ministers WHERE church_id=$1', [church])).rowCount > 0)
      })
      await query("SELECT public.wf04_set_membership_access($1,$2,$3,'suspended',false)", [actor, church, peer])
      await asUser(peer, async () => {
        assert.equal((await query('SELECT id FROM public.ministers WHERE church_id=$1', [church])).rowCount, 0)
      })
    })
    await t.test('last admin, pending activation, identity changes and physical deletion are rejected', async () => {
      await rejects("SELECT public.wf04_set_membership_access($1,$2,$1,'suspended',false)", [actor, church], /WF04_LAST_ADMIN/)
      await rejects("SELECT public.wf04_set_membership_access($1,$2,$3,'active',false)", [actor, church, pending], /WF04_INVITATION_REQUIRED/)
      await rejects('UPDATE public.ministers SET church_id=$1 WHERE id=$2', [other, peer], /WF04_MEMBERSHIP_IDENTITY_IMMUTABLE/)
      await rejects('DELETE FROM public.ministers WHERE id=$1', [peer], /WF04_DEACTIVATE_REQUIRED/)
      await asUser(actor, async () => {
        await rejects("SELECT public.wf04_set_membership_access($1,$2,$3,'active',false)", [actor, church, peer], /permission denied/)
      })
    })
    await t.test('profile writes project atomically; local admin cannot rename someone globally', async () => {
      await query("UPDATE public.user_profiles SET name='WF04 nome global' WHERE user_id=$1", [peer])
      assert.equal((await query('SELECT name FROM public.ministers WHERE id=$1', [peer])).rows[0].name, 'WF04 nome global')
      await asUser(actor, async () => {
        await rejects("UPDATE public.ministers SET name='Nome local adulterado' WHERE id=$1", [peer], /WF04_GLOBAL_PROFILE_REQUIRED/)
        await rejects("UPDATE public.user_profiles SET name='Outro' WHERE user_id=$1", [peer], /permission denied/)
      })
    })
    await t.test('repeated suspension is idempotent and migration replay never reactivates it', async () => {
      const before = (await query('SELECT count(*)::int AS count FROM public.membership_access_audit WHERE minister_id=$1', [peer])).rows[0].count
      await query("SELECT public.wf04_set_membership_access($1,$2,$3,'suspended',false)", [actor, church, peer])
      assert.equal((await query('SELECT count(*)::int AS count FROM public.membership_access_audit WHERE minister_id=$1', [peer])).rows[0].count, before)
      const sql = fs.readFileSync(path.resolve(__dirname, '../scripts/038_onboarding_foundation.sql'), 'utf8')
        .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
      await query(sql)
      const row = (await query('SELECT access_state,is_active FROM public.ministers WHERE id=$1', [peer])).rows[0]
      assert.deepEqual(row, { access_state: 'suspended', is_active: false })
      assert.equal((await query('SELECT count(*)::int AS count FROM public.wf04_legacy_memberships WHERE minister_id=ANY($1::uuid[])', [[actor, peer, pending, foreign]])).rows[0].count, 0)
    })
    await t.test('Google credential backfill keeps one personal row and the original church selection', async () => {
      await query("INSERT INTO public.google_calendar_tokens(minister_id,church_id,access_token,refresh_token,expiry_date,scope,connected_at,updated_at) VALUES($1,$2,'legacy-access','legacy-refresh',1,'calendar.events',now()-interval '1 day',now())", [actor, church])
      const sql = fs.readFileSync(path.resolve(__dirname, '../scripts/039_google_calendar_identity.sql'), 'utf8')
        .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
      await query(sql)

      const credential = (await query('SELECT refresh_token FROM public.google_calendar_credentials WHERE user_id=$1', [actor])).rows
      assert.deepEqual(credential, [{ refresh_token: 'legacy-refresh' }])
      const selection = (await query('SELECT church_id::text AS church_id, minister_id::text AS minister_id FROM public.google_calendar_church_sync WHERE user_id=$1', [actor])).rows
      assert.deepEqual(selection, [{ church_id: church, minister_id: actor }])

      await query("INSERT INTO public.google_calendar_event_map(minister_id,church_id,event_key,google_event_id,content_hash) VALUES($1,$2,'2026-01-01_sunday','google-event','hash')", [actor, church])
      await query(sql)
      assert.equal((await query('SELECT user_id FROM public.google_calendar_event_map WHERE google_event_id=$1', ['google-event'])).rows[0].user_id, actor)

      await asUser(actor, async () => {
        await rejects('SELECT * FROM public.google_calendar_credentials', [], /permission denied/)
        await rejects('SELECT * FROM public.google_calendar_church_sync', [], /permission denied/)
      })
    })
  } finally {
    await query('ROLLBACK')
    await db.end()
  }
})

test('WF-04 concurrent self-suspension preserves one active administrator', async () => {
  const db = new Client({ connectionString: url.toString() })
  const first = new Client({ connectionString: url.toString() })
  const second = new Client({ connectionString: url.toString() })
  await Promise.all([db.connect(), first.connect(), second.connect()])
  const church = randomUUID(), a = randomUUID(), b = randomUUID()
  let fixtures = false
  try {
    await db.query('BEGIN')
    try {
      await db.query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1::uuid,'WF04 concurrency',$1::uuid::text,'test','disabled')", [church])
      for (const id of [a, b]) {
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@wf04.local.test`])
        await db.query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,access_state) VALUES($1,$1,$2,'Admin concorrente','admin','Voz','active')", [id, church])
      }
      await db.query('COMMIT'); fixtures = true
    } catch (error) { await db.query('ROLLBACK'); throw error }
    const results = await Promise.allSettled([
      first.query("SELECT public.wf04_set_membership_access($1,$2,$1,'suspended',false)", [a, church]),
      second.query("SELECT public.wf04_set_membership_access($1,$2,$1,'suspended',false)", [b, church]),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = results.find(result => result.status === 'rejected')
    assert.match(rejected.reason.message, /WF04_LAST_ADMIN/)
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.ministers WHERE church_id=$1 AND role='admin' AND access_state='active'", [church])).rows[0].count, 1)
  } finally {
    try {
      if (fixtures) {
        await db.query('BEGIN')
        try {
          await db.query("SELECT set_config('wf04.maintenance','on',true)")
          await db.query('DELETE FROM public.membership_access_audit WHERE church_id=$1', [church])
          await db.query('DELETE FROM public.ministers WHERE church_id=$1', [church])
          await db.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[a, b]])
          await db.query('DELETE FROM public.churches WHERE id=$1', [church])
          await db.query('COMMIT')
        } catch (error) { await db.query('ROLLBACK'); throw error }
      }
    } finally { await Promise.all([db.end(), first.end(), second.end()]) }
  }
})
