// Real PostgreSQL checks for WF-04 invitations. Everything runs in one transaction
// that is always rolled back; no fixture survives the test.
const assert = require('node:assert/strict')
const { createHash, randomBytes, randomUUID } = require('node:crypto')
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

const hash = token => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()

test('WF-04 invitations: lifecycle, idempotent accept, second church and isolation', async t => {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  const query = (sql, values) => db.query(sql, values)
  async function rejects(sql, values, pattern) {
    await query('SAVEPOINT wf04_inv')
    try { await assert.rejects(query(sql, values), pattern) }
    finally { await query('ROLLBACK TO SAVEPOINT wf04_inv') }
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
    const ready = await query("SELECT to_regclass('public.wf04_invitations') AS inv, to_regclass('public.wf04_invitation_outbox') AS outbox")
    assert.ok(ready.rows[0].inv && ready.rows[0].outbox, 'Apply migration 040 before this test')
    const constraints = await query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='ministers'
      AND indexname IN ('ministers_email_key','ministers_user_id_unique_idx')`)
    assert.equal(constraints.rowCount, 0, 'Apply migration 041 before this test')

    const churchA = randomUUID(), churchB = randomUUID()
    const admin = randomUUID(), guest = randomUUID(), stranger = randomUUID()
    const email = `invitee-${randomUUID()}@wf04.local.test`
    const inviteeId = randomUUID()
    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES ($1::uuid,'Inv A',$1::uuid::text,'test','disabled'),($2::uuid,'Inv B',$2::uuid::text,'test','disabled')", [churchA, churchB])
    for (const id of [admin, guest, stranger]) {
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@wf04.local.test`])
    }
    await query("INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES($1,$1,$2,'Admin A',$3,'admin','Voz','active')", [admin, churchA, `${admin}@wf04.local.test`])
    await query("INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES($1,$1,$2,'Guest A',$3,'minister','Voz','active')", [guest, churchA, `${guest}@wf04.local.test`])
    await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [inviteeId, email])
    await query("INSERT INTO public.user_profiles(user_id,name) VALUES($1,'Convidada')", [inviteeId])

    const tokenOne = newToken()
    let tokenCurrent = null
    const created = await query(
      "SELECT public.wf04_create_invitation($1,$2,$3,'Convidada','minister','Voz',$4,$5,'cipher-text-placeholder') AS result",
      [admin, churchA, email, hash(tokenOne), future()])
    const invitationId = created.rows[0].result.invitation_id
    assert.ok(invitationId, 'admin creates an invitation')

    await t.test('only an active admin of the church can create or revoke invitations', async () => {
      await rejects("SELECT public.wf04_create_invitation($1,$2,'x@wf04.local.test','X','minister','Voz',$3,$4,'cipher-text-placeholder')",
        [guest, churchA, hash(newToken()), future()], /WF04_FORBIDDEN/)
      await rejects("SELECT public.wf04_create_invitation($1,$2,'x@wf04.local.test','X','minister','Voz',$3,$4,'cipher-text-placeholder')",
        [stranger, churchA, hash(newToken()), future()], /WF04_FORBIDDEN/)
      await rejects("SELECT public.wf04_revoke_invitation($1,$2,$3)", [guest, churchA, invitationId], /WF04_FORBIDDEN/)
    })

    await t.test('recreating for the same e-mail rotates the token and invalidates the old one', async () => {
      const tokenTwo = newToken()
      const rotated = await query(
        "SELECT public.wf04_create_invitation($1,$2,$3,'Convidada','minister','Voz',$4,$5,'cipher-text-placeholder') AS result",
        [admin, churchA, email, hash(tokenTwo), future()])
      assert.equal(rotated.rows[0].result.invitation_id, invitationId)
      assert.equal(rotated.rows[0].result.version, 2)
      await rejects('SELECT public.wf04_inspect_invitation($1)', [hash(tokenOne)], /WF04_INVITATION_UNAVAILABLE/)
    })

    await t.test('inspection is read-only and exposes no token or raw e-mail', async () => {
      const tokenTwo = newToken()
      await query("SELECT public.wf04_rotate_invitation($1,$2,$3,$4,$5,'cipher-text-placeholder')",
        [admin, churchA, invitationId, hash(tokenTwo), future()])
      const before = (await query('SELECT version, last_sent_at FROM public.wf04_invitations WHERE id=$1', [invitationId])).rows[0]
      const inspected = (await query('SELECT public.wf04_inspect_invitation($1) AS r', [hash(tokenTwo)])).rows[0].r
      const after = (await query('SELECT version, last_sent_at FROM public.wf04_invitations WHERE id=$1', [invitationId])).rows[0]
      assert.deepEqual(after, before)
      assert.equal(inspected.state, 'pending')
      assert.ok(!JSON.stringify(inspected).includes(email), 'raw e-mail is not exposed')
      assert.ok(!JSON.stringify(inspected).includes(tokenTwo), 'token is not exposed')
      tokenCurrent = tokenTwo
    })

    await t.test('authenticated clients cannot read invitation tables directly', async () => {
      await asUser(admin, async () => {
        await rejects('SELECT id FROM public.wf04_invitations', [], /permission denied/)
        await rejects('SELECT id FROM public.wf04_invitation_outbox', [], /permission denied/)
      })
    })

    await t.test('a different identity cannot accept; the invitee accepts once, replay is idempotent', async () => {
      await rejects('SELECT public.wf04_accept_invitation($1,$2)', [stranger, hash(tokenCurrent)], /WF04_EMAIL_MISMATCH/)
      const first = (await query('SELECT public.wf04_accept_invitation($1,$2) AS r', [inviteeId, hash(tokenCurrent)])).rows[0].r
      assert.equal(first.status, 'active')
      assert.equal(first.idempotent, false)
      const replay = (await query('SELECT public.wf04_accept_invitation($1,$2) AS r', [inviteeId, hash(tokenCurrent)])).rows[0].r
      assert.equal(replay.idempotent, true)
      assert.equal(replay.minister_id, first.minister_id)
      const rows = (await query('SELECT count(*)::int AS c FROM public.ministers WHERE user_id=$1 AND church_id=$2', [inviteeId, churchA])).rows[0].c
      assert.equal(rows, 1)
    })

    await t.test('the same identity can join a second church with the same account', async () => {
      const tokenB = newToken()
      const adminB = randomUUID()
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [adminB, `${adminB}@wf04.local.test`])
      await query("INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES($1,$1,$2,'Admin B',$3,'admin','Voz','active')", [adminB, churchB, `${adminB}@wf04.local.test`])
      await query("SELECT public.wf04_create_invitation($1,$2,$3,'Convidada','minister','Voz',$4,$5,'cipher-text-placeholder')",
        [adminB, churchB, email, hash(tokenB), future()])
      const accepted = (await query('SELECT public.wf04_accept_invitation($1,$2) AS r', [inviteeId, hash(tokenB)])).rows[0].r
      assert.equal(accepted.church_id, churchB)
      assert.equal(accepted.status, 'active')
      const memberships = (await query('SELECT church_id FROM public.ministers WHERE user_id=$1 ORDER BY church_id', [inviteeId])).rows
      assert.equal(memberships.length, 2)
    })

    await t.test('revoked and expired invitations cannot be accepted and are not consumed by inspection', async () => {
      const tokenR = newToken()
      const expiring = randomUUID()
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [expiring, `${expiring}@wf04.local.test`])
      await query("SELECT public.wf04_create_invitation($1,$2,$3,'Expirada','minister','Voz',$4,$5,'cipher-text-placeholder')",
        [admin, churchA, `${expiring}@wf04.local.test`, hash(tokenR), future()])
      await query("UPDATE public.wf04_invitations SET expires_at = now() - interval '1 minute' WHERE token_hash=$1", [hash(tokenR)])
      const state = (await query('SELECT public.wf04_inspect_invitation($1) AS r', [hash(tokenR)])).rows[0].r.state
      assert.equal(state, 'expired')
      await rejects('SELECT public.wf04_accept_invitation($1,$2)', [expiring, hash(tokenR)], /WF04_INVITATION_EXPIRED/)

      const tokenV = newToken()
      const revokedEmail = `${randomUUID()}@wf04.local.test`
      const revoked = (await query("SELECT public.wf04_create_invitation($1,$2,$3,'Revogada','minister','Voz',$4,$5,'cipher-text-placeholder') AS r",
        [admin, churchA, revokedEmail, hash(tokenV), future()])).rows[0].r
      await query('SELECT public.wf04_revoke_invitation($1,$2,$3)', [admin, churchA, revoked.invitation_id])
      const outbox = (await query('SELECT status FROM public.wf04_invitation_outbox WHERE invitation_id=$1 ORDER BY version DESC LIMIT 1', [revoked.invitation_id])).rows[0]
      assert.equal(outbox.status, 'skipped')
      const revokedState = (await query('SELECT public.wf04_inspect_invitation($1) AS r', [hash(tokenV)])).rows[0].r.state
      assert.equal(revokedState, 'revoked')
      await rejects('SELECT public.wf04_accept_invitation($1,$2)', [inviteeId, hash(tokenV)], /WF04_INVITATION_UNAVAILABLE/)
    })

    await t.test('the database rejects moving a row to another church and duplicate memberships', async () => {
      await rejects('UPDATE public.ministers SET church_id=$1 WHERE id=$2', [churchB, guest], /WF04_MEMBERSHIP_IDENTITY_IMMUTABLE/)
      await rejects("INSERT INTO public.ministers(user_id,church_id,name,email,role,instrument,access_state) VALUES($1,$2,'Dup','dup@wf04.local.test','minister','Voz','active')",
        [guest, churchA], /ministers_church_user_unique_idx|duplicate key/)
    })
  } finally {
    await query('ROLLBACK').catch(() => undefined)
    await db.end()
  }
})
