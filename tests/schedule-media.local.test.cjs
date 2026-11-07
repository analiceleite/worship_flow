// Real RLS checks. No dotenv; fixtures are rolled back and no remote DB is allowed.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY) {
  throw new Error('Use pnpm local:test; refusing non-local runtime.')
}
const url = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (!((url.hostname === '127.0.0.1' && url.port === '54322') ||
    (process.env.LOCAL_DOCKER === 'true' && url.hostname === 'db' && url.port === '5432')) || url.pathname !== '/postgres') {
  throw new Error('Refusing non-local integration database')
}

test('WF-11 real RLS: published-only media reads, no writes, tenant and role regressions', async t => {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  const church = randomUUID(), other = randomUUID(), published = randomUUID(), draft = randomUUID(), foreign = randomUUID()
  const media = randomUUID(), minister = randomUUID(), admin = randomUUID()
  const identities = [media, minister, admin]
  const query = (sql, values) => db.query(sql, values)
  async function asUser(user, fn) {
    await query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [user, JSON.stringify({ sub: user, role: 'authenticated' })])
    await query('SET LOCAL ROLE authenticated')
    try { await fn() } finally { await query('RESET ROLE') }
  }
  async function rejected(sql, args) {
    await query('SAVEPOINT wf11_write')
    try { await assert.rejects(query(sql, args), /row-level security|permission denied/) }
    finally { await query('ROLLBACK TO SAVEPOINT wf11_write') }
  }
  await query('BEGIN')
  try {
    // Fail explicitly when the new migration has not been applied locally.
    const policy = await query("SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='schedule_quarters' AND policyname='wf11_quarters_read'")
    assert.equal(policy.rowCount, 1, 'Apply migration 037 to the local database before testing')
    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1,'WF11 local',$1::uuid::text,'test','disabled'),($2,'WF11 other',$2::uuid::text,'test','disabled')", [church, other])
    for (const [index, role] of ['midia', 'minister', 'admin'].entries()) {
      const id = identities[index]
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@wf11.local.test`])
      await query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,is_active) VALUES($1,$1,$2,'WF11 integrante',$3,'Sonoplasta',true)", [id, church, role])
    }
    const roleId = (await query("SELECT id FROM public.schedule_roles WHERE category='midia' LIMIT 1")).rows[0]?.id
    assert.ok(roleId, 'Local migrations must include Sonoplasta')
    for (const [id, tenant, isPublished] of [[published, church, true], [draft, church, false], [foreign, other, true]]) {
      await query("INSERT INTO public.schedule_quarters(id,church_id,name,start_date,end_date,is_published) VALUES($1,$2,'WF11 período','2026-11-01','2026-12-31',$3)", [id, tenant, isPublished])
      await query("INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type) VALUES($1,$2,$3,'2026-11-08','sunday')", [tenant, id, roleId])
      await query("INSERT INTO public.schedule_rehearsals(church_id,quarter_id,event_date,event_type,rehearsal_date,rehearsal_time) VALUES($1,$2,'2026-11-08','sunday','2026-11-07','19:00')", [tenant, id])
    }
    const ownQuarterIds = [published, draft]
    await t.test('media sees only own church published rows through direct table access', async () => {
      await asUser(media, async () => {
        for (const table of ['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals']) {
          const column = table === 'schedule_quarters' ? 'id' : 'quarter_id'
          const result = await query(`SELECT ${column} AS quarter FROM public.${table} WHERE church_id=ANY($1::uuid[])`, [[church, other]])
          assert.deepEqual(result.rows.map(row => row.quarter), [published], table)
        }
      })
    })
    await t.test('media cannot insert/update/delete even published rows', async () => {
      await asUser(media, async () => {
        await rejected("INSERT INTO public.schedule_quarters(church_id,name,start_date,end_date) VALUES($1,'Unauthorized','2026-11-01','2026-12-31')", [church])
        await rejected("INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type) VALUES($1,$2,$3,'2026-11-15','sunday')", [church, published, roleId])
        await rejected("INSERT INTO public.schedule_rehearsals(church_id,quarter_id,event_date,event_type) VALUES($1,$2,'2026-11-15','sunday')", [church, published])
        for (const table of ['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals']) {
          const update = await query(`UPDATE public.${table} SET church_id=church_id WHERE church_id=$1 RETURNING id`, [church])
          assert.equal(update.rowCount, 0, table)
          const remove = await query(`DELETE FROM public.${table} WHERE church_id=$1 RETURNING id`, [church])
          assert.equal(remove.rowCount, 0, table)
        }
      })
    })
    await t.test('admin/minister still read own drafts, never other tenants', async () => {
      for (const user of [minister, admin]) await asUser(user, async () => {
        for (const table of ['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals']) {
          const column = table === 'schedule_quarters' ? 'id' : 'quarter_id'
          const result = await query(`SELECT ${column} AS quarter FROM public.${table} WHERE church_id=ANY($1::uuid[])`, [[church, other]])
          assert.deepEqual(result.rows.map(row => row.quarter).sort(), [...ownQuarterIds].sort())
        }
        assert.equal((await query("UPDATE public.schedule_rehearsals SET rehearsal_place='WF11 sala' WHERE quarter_id=$1 RETURNING id", [draft])).rowCount, 1)
      })
      await asUser(admin, async () => {
        assert.equal((await query("UPDATE public.schedule_quarters SET name='WF11 edição' WHERE id=$1 RETURNING id", [draft])).rowCount, 1)
        assert.equal((await query('UPDATE public.schedule_assignments SET minister_id=$1 WHERE quarter_id=$2 RETURNING id', [media, published])).rowCount, 1)
      })
    })
    await t.test('unpublishing immediately removes media access', async () => {
      await query('UPDATE public.schedule_quarters SET is_published=false WHERE id=$1', [published])
      await asUser(media, async () => {
        for (const table of ['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals']) {
          assert.equal((await query(`SELECT id FROM public.${table} WHERE church_id=$1`, [church])).rowCount, 0)
        }
      })
    })
  } finally {
    await query('ROLLBACK')
    await db.end()
  }
})
