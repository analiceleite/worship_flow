// WF-39: database-level isolation between churches (RLS), run against the isolated local runtime.
// Everything runs in one transaction that is always rolled back; no fixture survives the test.
const assert = require('node:assert/strict')
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

test('WF-39 isolation: users of church A never read or write church B data (RLS)', async () => {
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  const query = (sql, values) => db.query(sql, values)

  // Runs a statement inside a savepoint and reports what happened, without leaving changes behind.
  async function attempt(sql, values) {
    await query('SAVEPOINT wf39_try')
    try {
      const result = await query(sql, values)
      return { rowCount: result.rowCount, rows: result.rows, code: null }
    } catch (error) {
      return { rowCount: 0, rows: [], code: error.code || 'error' }
    } finally {
      await query('ROLLBACK TO SAVEPOINT wf39_try')
    }
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
    const ready = await query("SELECT to_regclass('public.wf04_invitations') AS inv, to_regprocedure('public.wf39_cifra_path_allowed(text)') AS cifra")
    assert.ok(ready.rows[0].inv, 'Apply migrations up to 041 before this test')
    assert.ok(ready.rows[0].cifra, 'Apply migration 044 (cifras storage isolation) before this test')

    const churchA = randomUUID(), churchB = randomUUID()
    const userAdminA = randomUUID(), userAdminB = randomUUID(), userMulti = randomUUID()
    const mAdminA = randomUUID(), mAdminB = randomUUID(), mMultiA = randomUUID(), mMultiB = randomUUID()
    const songA = randomUUID(), songB = randomUUID()
    const eventA = randomUUID(), eventB = randomUUID()
    const quarterA = randomUUID(), quarterB = randomUUID()
    const repertoireA = randomUUID(), repertoireB = randomUUID()

    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES ($1::uuid,'Iso A',$3,'test','disabled'),($2::uuid,'Iso B',$4,'test','disabled')",
      [churchA, churchB, `wf39-a-${churchA}`, `wf39-b-${churchB}`])
    for (const id of [userAdminA, userAdminB, userMulti]) {
      await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@wf39.local.test`])
    }
    await query(`INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES
      ($1,$2,$3,'Admin A','a@wf39.local.test','admin','Voz','active'),
      ($4,$5,$6,'Admin B','b@wf39.local.test','admin','Voz','active'),
      ($7,$8,$3,'Multi em A','m@wf39.local.test','minister','Voz','active'),
      ($9,$8,$6,'Multi em B','m@wf39.local.test','minister','Voz','active')`,
    [mAdminA, userAdminA, churchA, mAdminB, userAdminB, churchB, mMultiA, userMulti, mMultiB])
    await query(`INSERT INTO public.songs(id,title,artist,church_id,minister_id) VALUES
      ($1,'Música A','Artista',$2,$3),($4,'Música B','Artista',$5,$6)`, [songA, churchA, mAdminA, songB, churchB, mAdminB])
    await query(`INSERT INTO public.special_events(id,name,event_date,church_id) VALUES
      ($1,'Evento A',CURRENT_DATE,$2),($3,'Evento B',CURRENT_DATE,$4)`, [eventA, churchA, eventB, churchB])
    await query(`INSERT INTO public.schedule_quarters(id,name,start_date,end_date,is_published,church_id) VALUES
      ($1,'Trimestre A',CURRENT_DATE,CURRENT_DATE+90,true,$2),($3,'Trimestre B',CURRENT_DATE,CURRENT_DATE+90,true,$4)`,
    [quarterA, churchA, quarterB, churchB])
    // Repertoire writes are guarded by WF-07 (wf07_guard_write). Fixtures are seeded as the owner with the
    // guard open for this transaction only; the isolation checks below still run as authenticated users.
    await query("SELECT set_config('wf07.writing','on',true)")
    await query(`INSERT INTO public.repertoire(id,minister_id,song_id,event_date,order_index,church_id) VALUES
      ($1,$2,$3,CURRENT_DATE,1,$4),($5,$6,$7,CURRENT_DATE,1,$8)`,
    [repertoireA, mAdminA, songA, churchA, repertoireB, mAdminB, songB, churchB])
    // Cifra PDFs: current layout {churchId}/{songId}/cifra.pdf and legacy layout {songId}/cifra.pdf (migration 022).
    const cifraA = `${churchA}/${songA}/cifra.pdf`, cifraB = `${churchB}/${songB}/cifra.pdf`
    const legacyA = `${songA}/cifra.pdf`, legacyB = `${songB}/cifra.pdf`
    await query(`INSERT INTO storage.objects(bucket_id,name) VALUES
      ('cifras',$1),('cifras',$2),('cifras',$3),('cifras',$4)`, [cifraA, cifraB, legacyA, legacyB])
    // Ids are resolved as the owner, before switching roles: a member of church A cannot see church B objects.
    const objectIds = Object.fromEntries((await query("SELECT name, id FROM storage.objects WHERE bucket_id='cifras'"))
      .rows.map(r => [r.name, r.id]))
    const cifraObject = (name) => {
      assert.ok(objectIds[name], `fixture object missing: ${name}`)
      return objectIds[name]
    }

    await asUser(userAdminA, async () => {
      // Storage: church A members see only church A PDFs (current and legacy layouts).
      const visible = await query("SELECT name FROM storage.objects WHERE bucket_id='cifras' ORDER BY name")
      assert.deepEqual(visible.rows.map(r => r.name).sort(), [cifraA, legacyA].sort(), 'admin A must see only church A PDFs')
      // Positive control: the same statement succeeds on the admin's own church object, so the B denial is real.
      assert.equal((await attempt("UPDATE storage.objects SET name=name WHERE id=$1", [cifraObject(cifraA)])).rowCount, 1,
        'admin A can update a church A PDF')
      assert.equal((await attempt("UPDATE storage.objects SET name=name WHERE id=$1", [cifraObject(cifraB)])).rowCount, 0,
        'cannot update a church B PDF')
      assert.equal((await attempt("DELETE FROM storage.objects WHERE id=$1", [cifraObject(legacyB)])).rowCount, 0,
        'cannot delete a legacy church B PDF')
      assert.equal((await attempt("INSERT INTO storage.objects(bucket_id,name) VALUES ('cifras',$1)",
        [`${churchB}/${randomUUID()}/cifra.pdf`])).code, '42501', 'cannot upload into church B path')
      assert.equal((await attempt("INSERT INTO storage.objects(bucket_id,name) VALUES ('cifras',$1)",
        [`${songB}/cifra.pdf`])).code, '42501', 'cannot upload over a legacy church B song path')
      assert.equal((await attempt("INSERT INTO storage.objects(bucket_id,name) VALUES ('cifras',$1)",
        ['not-a-uuid/cifra.pdf'])).code, '42501', 'malformed folder is denied')

      // Cache: shared by design, but no signed-in user may read or write it directly (server-only via service role).
      assert.equal((await attempt('SELECT 1 FROM public.youtube_search_cache')).code, '42501', 'cache is not readable by users')
      assert.equal((await attempt(`INSERT INTO public.youtube_search_cache(query_key,query_text,max_results,results,expires_at)
        VALUES ('m1:poison','poison',1,'[]'::jsonb,now()+interval '1 day')`)).code, '42501', 'cache is not writable by users')
    })

    await asUser(userAdminB, async () => {
      const visible = await query("SELECT name FROM storage.objects WHERE bucket_id='cifras' ORDER BY name")
      assert.deepEqual(visible.rows.map(r => r.name).sort(), [cifraB, legacyB].sort(), 'admin B must see only church B PDFs')
      assert.equal((await attempt("DELETE FROM storage.objects WHERE id=$1", [cifraObject(cifraA)])).rowCount, 0)
    })

    await asUser(userMulti, async () => {
      // Membership in both churches: both churches' PDFs are readable, each under its own membership.
      const visible = await query("SELECT name FROM storage.objects WHERE bucket_id='cifras'")
      assert.equal(visible.rowCount, 4, 'multi-church user sees PDFs of both churches')
    })

    await asUser(userAdminA, async () => {
      // Reads: only church A rows are visible, even when filtering by church B explicitly.
      const songs = await query('SELECT id FROM public.songs')
      assert.deepEqual(songs.rows.map(r => r.id), [songA], 'admin A must see only song A')
      assert.equal((await query('SELECT id FROM public.songs WHERE church_id=$1', [churchB])).rowCount, 0)
      assert.deepEqual((await query('SELECT id FROM public.special_events')).rows.map(r => r.id), [eventA])
      assert.deepEqual((await query('SELECT id FROM public.schedule_quarters')).rows.map(r => r.id), [quarterA])
      assert.deepEqual((await query('SELECT id FROM public.ministers ORDER BY name')).rows.map(r => r.id).sort(),
        [mAdminA, mMultiA].sort(), 'admin A must see only church A ministers')
      assert.deepEqual((await query('SELECT id FROM public.repertoire')).rows.map(r => r.id), [repertoireA])

      // Writes into church B: updates/deletes affect nothing; inserts are rejected by RLS.
      assert.equal((await attempt('UPDATE public.songs SET title=$2 WHERE id=$1', [songB, 'Invadida'])).rowCount, 0)
      assert.equal((await attempt('DELETE FROM public.songs WHERE id=$1', [songB])).rowCount, 0)
      assert.equal((await attempt('UPDATE public.special_events SET name=$2 WHERE id=$1', [eventB, 'Invadido'])).rowCount, 0)
      assert.equal((await attempt('UPDATE public.schedule_quarters SET is_published=false WHERE id=$1', [quarterB])).rowCount, 0)
      assert.equal((await attempt('UPDATE public.ministers SET name=$2 WHERE id=$1', [mAdminB, 'Invadido'])).rowCount, 0)
      assert.equal((await attempt('DELETE FROM public.repertoire WHERE id=$1', [repertoireB])).rowCount, 0)

      assert.equal((await attempt(`INSERT INTO public.songs(title,artist,church_id,minister_id)
        VALUES ('X','Y',$1,$2)`, [churchB, mAdminA])).code, '42501', 'insert song into church B must be denied')
      assert.equal((await attempt(`INSERT INTO public.special_events(name,event_date,church_id)
        VALUES ('X',CURRENT_DATE,$1)`, [churchB])).code, '42501', 'insert event into church B must be denied')
      assert.equal((await attempt(`INSERT INTO public.schedule_quarters(name,start_date,end_date,church_id)
        VALUES ('X',CURRENT_DATE,CURRENT_DATE,$1)`, [churchB])).code, '42501', 'insert quarter into church B must be denied')
      assert.equal((await attempt(`INSERT INTO public.ministers(name,church_id,role,access_state)
        VALUES ('X',$1,'minister','active')`, [churchB])).code, '42501', 'insert minister into church B must be denied')
    })

    await asUser(userMulti, async () => {
      // A user with memberships in both churches sees both, but each write is checked against
      // the membership of the row's own church (not whichever membership the helper happens to return).
      const songs = await query('SELECT id FROM public.songs ORDER BY title')
      assert.deepEqual(songs.rows.map(r => r.id).sort(), [songA, songB].sort(), 'multi-church user sees both churches')

      assert.equal((await attempt('UPDATE public.songs SET title=$2 WHERE id=$1', [songB, 'Editada'])).rowCount, 0,
        'minister in B cannot edit a song owned by an admin of B')
      assert.equal((await attempt(`INSERT INTO public.songs(title,artist,church_id,minister_id)
        VALUES ('X','Y',$1,$2)`, [churchB, mMultiA])).code, '42501',
      'membership in A cannot be used to insert a song into church B')
      assert.equal((await attempt(`INSERT INTO public.repertoire(minister_id,song_id,event_date,order_index,church_id)
        VALUES ($1,$2,CURRENT_DATE,2,$3)`, [mMultiB, songA, churchB])).code, '42501',
      'repertoire item in B cannot reference a song from A')
    })
  } finally {
    await query('ROLLBACK')
    await db.end()
  }
})
