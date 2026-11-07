// Preflight against the dedicated local stack, before 038 is persisted.
// The migration and all fixtures are rolled back, including the legacy cutover.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY) {
  throw new Error('Refusing non-local migration preflight')
}
const url = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (url.hostname !== '127.0.0.1' || url.port !== '54322' || url.pathname !== '/postgres') {
  throw new Error('Refusing non-loopback migration preflight')
}

test('038 preflight: inactive legacy becomes active once; later entrants stay pending', async t => {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  await db.query('BEGIN')
  try {
    assert.equal((await db.query("SELECT current_setting('wf07.browser_test',true) AS enabled")).rows[0].enabled, 'on')
    if ((await db.query("SELECT to_regclass('public.wf04_legacy_cutover') AS ready")).rows[0].ready) {
      t.skip('The expansion migration is already applied; preserve its cutover instead of resetting history.')
      return
    }
    const church = randomUUID(), actor = randomUUID(), later = randomUUID()
    await db.query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1::uuid,'WF04 preflight',$1::uuid::text,'test','disabled')", [church])
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [actor, `${actor}@wf04.local.test`])
    await db.query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,is_active) VALUES($1,$1,$2,'Legacy false','minister','Voz',false)", [actor, church])
    const sql = fs.readFileSync(path.resolve(__dirname, '../scripts/038_onboarding_foundation.sql'), 'utf8')
      .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
    await db.query(sql)
    assert.deepEqual((await db.query('SELECT access_state,is_active FROM public.ministers WHERE id=$1', [actor])).rows[0], { access_state: 'active', is_active: true })
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.wf04_legacy_memberships WHERE minister_id=$1', [actor])).rows[0].count, 1)
    assert.equal((await db.query('SELECT name FROM public.user_profiles WHERE user_id=$1', [actor])).rows[0].name, 'Legacy false')
    await db.query("UPDATE public.ministers SET access_state='suspended' WHERE id=$1", [actor])
    await db.query("INSERT INTO public.ministers(id,church_id,name,role,instrument) VALUES($1,$2,'Later entrant','minister','Voz')", [later, church])
    await db.query(sql)
    assert.deepEqual((await db.query('SELECT access_state,is_active FROM public.ministers WHERE id=$1', [actor])).rows[0], { access_state: 'suspended', is_active: false })
    assert.deepEqual((await db.query('SELECT access_state,is_active FROM public.ministers WHERE id=$1', [later])).rows[0], { access_state: 'pending', is_active: false })
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.wf04_legacy_memberships WHERE minister_id=$1', [later])).rows[0].count, 0)
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
})
