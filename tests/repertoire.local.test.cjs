// Real PostgreSQL integration. No dotenv; strictly limited to isolated local runtime.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')

if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' || process.env.RESEND_API_KEY) {
  throw new Error('Use pnpm local:test or local Docker Compose; refusing non-local runtime.')
}
const url = new URL(process.env.LOCAL_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres')
if (!((url.hostname === '127.0.0.1' && url.port === '54322') ||
    (process.env.LOCAL_DOCKER === 'true' && url.hostname === 'db' && url.port === '5432')) || url.pathname !== '/postgres') {
  throw new Error('Refusing non-local integration database')
}
const apiUrl = process.env.LOCAL_DOCKER === 'true' ? 'http://gateway:8000' : process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(apiUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

test('WF-07 real database: integrity, concurrent edits, rollback, grants and tenants', async t => {
  const db = new Client({ connectionString: url.toString() })
  const db2 = new Client({ connectionString: url.toString() })
  await db.connect()
  await db2.connect()
  const church = randomUUID(), otherChurch = randomUUID(), actor = randomUUID(), vocal = randomUUID(), media = randomUUID()
  const minister = randomUUID(), vocalMinister = randomUUID(), mediaMinister = randomUUID()
  const foreignMinister = randomUUID(), foreignSong = randomUUID()
  const songs = Array.from({ length: 30 }, () => randomUUID())
  const date = '2026-11-08', name = `WF07 ${randomUUID()}`
  const users = []
  const query = (sql, values) => db.query(sql, values)
  async function mutate(command, revision, connection = db, user = actor, tenant = church, eventName = name, impersonating = false) {
    const result = await connection.query('SELECT public.wf07_mutate($1,$2,$3,$4,$5,$6,$7) AS snapshot',
      [user, tenant, impersonating, date, eventName, revision, JSON.stringify(command)])
    return result.rows[0].snapshot
  }
  async function read(user = actor, tenant = church, eventName = name, impersonating = false) {
    return (await query('SELECT public.wf07_read($1,$2,$3,$4,$5) AS snapshot', [user, tenant, impersonating, date, eventName])).rows[0].snapshot
  }
  function contiguous(snapshot) {
    assert.equal(snapshot.total, snapshot.items.length)
    assert.deepEqual(snapshot.items.map(item => item.order_index), snapshot.items.map((_, index) => index + 1))
    assert.equal(new Set(snapshot.items.map(item => item.song_id)).size, snapshot.items.length)
  }
  try {
    for (const id of [actor, vocal, media]) {
      const { error } = await admin.auth.admin.createUser({ id, email: `${id}@wf07.local.test`, password: `Aa1!${randomUUID()}`, email_confirm: true })
      assert.equal(error, null)
      users.push(id)
    }
    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1::uuid,'WF07 local',$1::uuid::text,'test','disabled'),($2::uuid,'WF07 other',$2::uuid::text,'test','disabled')", [church, otherChurch])
    await query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,access_state) VALUES($1,$2,$3,'Admin teste','admin','Voz','active'),($4,$5,$3,'Voz teste','minister',' Violão, Voz ','active'),($6,$7,$3,'Mídia teste','midia','Sonoplasta','active')", [minister, actor, church, vocalMinister, vocal, mediaMinister, media])
    await query("INSERT INTO public.ministers(id,church_id,name,role,instrument,access_state) VALUES($1,$2,'Outra igreja','minister','Voz','active')", [foreignMinister, otherChurch])
    await query("INSERT INTO public.songs(id,church_id,minister_id,title,artist,tone) VALUES($1,$2,$3,'Outra música','Artista fictício','D')", [foreignSong, otherChurch, foreignMinister])
    await query('INSERT INTO public.platform_admins(user_id) VALUES($1)', [actor])
    const foreignState = await mutate({ action: 'add', songId: foreignSong, ministerId: foreignMinister }, '0', db, actor, otherChurch, name, true)
    await query('DELETE FROM public.platform_admins WHERE user_id=$1', [actor])
    for (let index = 0; index < songs.length; index++) {
      await query("INSERT INTO public.songs(id,church_id,minister_id,title,artist,tone) VALUES($1,$2,$3,$4,'Artista fictício','D')", [songs[index], church, minister, `Música ${index + 1}`])
    }
    await query("UPDATE public.songs SET cifra_content=ARRAY[repeat('Cifra fictícia ',10000)] WHERE id=$1", [songs[0]])
    let snapshot = await read()
    await t.test('append globally and exportable complete snapshot with 25 songs', async () => {
      for (const songId of songs.slice(0, 25)) snapshot = await mutate({ action: 'add', songId, ministerId: minister }, snapshot.revision)
      assert.equal(snapshot.total, 25)
      contiguous(snapshot)
      assert.equal(snapshot.items[0].song.cifra_available, true)
      assert.equal(Object.hasOwn(snapshot.items[0].song, 'cifra_content'), false)
      assert.ok(JSON.stringify(snapshot).length < 100000, 'Snapshot must not duplicate heavy cifra text')
      assert.deepEqual((await read()).items.map(item => item.song_id), songs.slice(0, 25))
    })
    await t.test('migration preserves legacy items, normalizes ties/nulls and refuses duplicates atomically', async () => {
      const schema = `wf07_fixture_${randomUUID().replaceAll('-', '')}`
      const migration = fs.readFileSync(path.join(__dirname, '../scripts/036_repertoire_sequences.sql'), 'utf8')
        .replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, '')
        .replaceAll('public.', `${schema}.`).replaceAll('search_path=public', `search_path=${schema}`)
      for (const duplicates of [false, true]) {
        await query('BEGIN')
        try {
          await query(`CREATE SCHEMA ${schema}`)
          await query(`CREATE TABLE ${schema}.churches (id uuid PRIMARY KEY)`)
          await query(`INSERT INTO ${schema}.churches VALUES($1)`, [church])
          for (const table of ['ministers', 'songs', 'special_events', 'platform_admins']) {
            await query(`CREATE TABLE ${schema}.${table} AS SELECT * FROM public.${table} WITH NO DATA`)
          }
          await query(`INSERT INTO ${schema}.songs SELECT * FROM public.songs WHERE church_id=$1`, [church])
          await query(`INSERT INTO ${schema}.ministers SELECT * FROM public.ministers WHERE church_id=$1`, [church])
          await query(`CREATE TABLE ${schema}.repertoire AS SELECT * FROM public.repertoire WHERE church_id=$1 ORDER BY order_index LIMIT 3`, [church])
          await query(`UPDATE ${schema}.repertoire SET event_name=NULL,order_index=8`)
          await query(`UPDATE ${schema}.repertoire SET order_index=NULL WHERE id=(SELECT id FROM ${schema}.repertoire ORDER BY id DESC LIMIT 1)`)
          if (duplicates) {
            await query(`INSERT INTO ${schema}.repertoire SELECT * FROM ${schema}.repertoire LIMIT 1`)
            await assert.rejects(query(migration), /WF07_DUPLICATES/)
          } else {
            const ids = (await query(`SELECT id FROM ${schema}.repertoire ORDER BY order_index ASC NULLS LAST,id`)).rows.map(row => row.id)
            await query(migration)
            const rows = (await query(`SELECT * FROM ${schema}.repertoire ORDER BY order_index`)).rows
            assert.deepEqual(rows.map(row => row.id), ids)
            assert.deepEqual(rows.map(row => row.order_index), [1, 2, 3])
            assert.ok(rows.every(row => row.event_name === ''))
          }
        } finally { await query('ROLLBACK') }
      }
      assert.deepEqual(await read(), snapshot)
    })
    await t.test('moves cross pages in both directions and preserve unrelated items', async () => {
      const moving = snapshot.items[9].id
      snapshot = await mutate({ action: 'move', itemId: moving, position: 11 }, snapshot.revision)
      assert.equal(snapshot.items[10].id, moving)
      snapshot = await mutate({ action: 'move', itemId: moving, position: 10 }, snapshot.revision)
      assert.deepEqual(snapshot.items.map(item => item.song_id), songs.slice(0, 25))
      const next = snapshot.items[19].id
      snapshot = await mutate({ action: 'move', itemId: next, position: 21 }, snapshot.revision)
      assert.equal(snapshot.items[20].id, next)
      contiguous(snapshot)
    })
    await t.test('two independent concurrent moves allow only one revision', async () => {
      const results = await Promise.allSettled([
        mutate({ action: 'move', itemId: snapshot.items[0].id, position: 3 }, snapshot.revision, db),
        mutate({ action: 'move', itemId: snapshot.items[1].id, position: 4 }, snapshot.revision, db2),
      ])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.match(results.find(r => r.status === 'rejected').reason.message, /WF07_CONFLICT/)
      snapshot = await read()
      contiguous(snapshot)
    })
    await t.test('move/add and move/remove conflicts cannot silently overwrite', async () => {
      for (const command of [{ action: 'add', songId: songs[25], ministerId: minister }, { action: 'remove', itemId: snapshot.items[24].id }]) {
        const results = await Promise.allSettled([
          mutate({ action: 'move', itemId: snapshot.items[0].id, position: 2 }, snapshot.revision, db),
          mutate(command, snapshot.revision, db2),
        ])
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
        assert.match(results.find(r => r.status === 'rejected').reason.message, /WF07_CONFLICT/)
        snapshot = await read()
        contiguous(snapshot)
      }
    })
    await t.test('duplicate detection covers every page', async () => {
      await assert.rejects(mutate({ action: 'add', songId: snapshot.items.at(-1).song_id, ministerId: minister }, snapshot.revision), /WF07_DUPLICATE/)
      assert.deepEqual(await read(), snapshot)
    })
    await t.test('first concurrent inserts into an empty event serialize safely', async () => {
      const empty = `${name} empty`
      const results = await Promise.allSettled([
        mutate({ action: 'add', songId: songs[27], ministerId: minister }, '0', db, actor, church, empty),
        mutate({ action: 'add', songId: songs[27], ministerId: minister }, '0', db2, actor, church, empty),
      ])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.match(results.find(r => r.status === 'rejected').reason.message, /WF07_CONFLICT/)
      assert.equal((await read(actor, church, empty)).total, 1)
    })
    await t.test('failure after writes rolls back every position and revision', async () => {
      await query(`CREATE FUNCTION public.wf07_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.church_id='${church}'::uuid THEN RAISE EXCEPTION 'WF07_INJECTED_FAILURE'; END IF; RETURN NEW; END $$`)
      await query('CREATE TRIGGER wf07_test_failure BEFORE UPDATE ON public.repertoire_sequences FOR EACH ROW EXECUTE FUNCTION public.wf07_test_failure()')
      try {
        await assert.rejects(mutate({ action: 'move', itemId: snapshot.items[0].id, position: snapshot.total }, snapshot.revision), /WF07_INJECTED_FAILURE/)
        assert.deepEqual(await read(), snapshot)
      } finally {
        await query('DROP TRIGGER wf07_test_failure ON public.repertoire_sequences')
        await query('DROP FUNCTION public.wf07_test_failure()')
      }
    })
    await t.test('uncertain response after commit is safely reconciled and cannot repeat old revision', async () => {
      const oldRevision = snapshot.revision
      const command = { action: 'add', songId: songs[29], ministerId: minister }
      await mutate(command, oldRevision) // Simulate caller losing the successful response.
      await assert.rejects(mutate(command, oldRevision), /WF07_CONFLICT/)
      snapshot = await read()
      assert.equal(snapshot.items.filter(item => item.song_id === songs[29]).length, 1)
    })
    await t.test('permissions, cross-tenant IDs and fake impersonation are rejected', async () => {
      await assert.rejects(read(actor, otherChurch), /WF07_FORBIDDEN/)
      await assert.rejects(read(actor, otherChurch, name, true), /WF07_FORBIDDEN/)
      await assert.rejects(mutate({ action: 'remove', itemId: snapshot.items[0].id }, snapshot.revision, db, media), /WF07_FORBIDDEN/)
      await assert.rejects(mutate({ action: 'add', songId: songs[28], ministerId: minister }, snapshot.revision, db, vocal), /WF07_FORBIDDEN/)
      await assert.rejects(mutate({ action: 'remove', itemId: randomUUID() }, snapshot.revision), /WF07_NOT_FOUND/)
      await assert.rejects(mutate({ action: 'remove', itemId: foreignState.items[0].id }, snapshot.revision), /WF07_NOT_FOUND/)
      await assert.rejects(mutate({ action: 'add', songId: foreignSong, ministerId: minister }, snapshot.revision), /WF07_NOT_FOUND/)
      const otherEvent = await read(actor, church, `${name} empty`)
      await assert.rejects(mutate({ action: 'move', itemId: otherEvent.items[0].id, position: 1 }, snapshot.revision), /WF07_NOT_FOUND/)
      assert.equal((await read(media)).total, snapshot.total)
    })
    await t.test('voice role with whitespace can move and add own music', async () => {
      await query('UPDATE public.songs SET minister_id=$1 WHERE id=$2', [vocalMinister, songs[28]])
      snapshot = await mutate({ action: 'add', songId: songs[28] }, snapshot.revision, db, vocal)
      assert.equal(snapshot.items.at(-1).minister_id, vocalMinister)
      contiguous(snapshot)
    })
    await t.test('RPCs and table writes cannot be bypassed by authenticated clients', async () => {
      await query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [actor, JSON.stringify({ sub: actor, role: 'authenticated' })])
      await query('SET ROLE authenticated')
      try {
        await assert.rejects(read(), /permission denied/)
        await assert.rejects(query('DELETE FROM public.repertoire WHERE id=$1', [snapshot.items[0].id]), /permission denied/)
        assert.equal((await query('SELECT count(*)::integer AS total FROM public.repertoire WHERE church_id=$1', [church])).rows[0].total, snapshot.total + 1)
        assert.equal((await query('SELECT count(*)::integer AS total FROM public.repertoire WHERE church_id=$1', [otherChurch])).rows[0].total, 0)
      } finally { await query('RESET ROLE') }
      await assert.rejects(query('DELETE FROM public.repertoire WHERE id=$1', [snapshot.items[0].id]), /WF07_PROTOCOL_REQUIRED/)
    })
    await t.test('valid platform impersonation can access selected church only', async () => {
      await query('INSERT INTO public.platform_admins(user_id) VALUES($1)', [actor])
      assert.equal((await read(actor, otherChurch, name, true)).total, 1)
      await query('DELETE FROM public.platform_admins WHERE user_id=$1', [actor])
    })
    await t.test('minister cleanup maintains contiguous order and advances revision', async () => {
      await query('SELECT public.wf07_remove_minister_items($1,$2,false,$3)', [actor, church, vocalMinister])
      const result = await read()
      assert.equal(result.total, snapshot.total - 1)
      assert.notEqual(result.revision, snapshot.revision)
      contiguous(result)
    })
    await t.test('event deletion is atomic, invalidates old revisions and preserves other events', async () => {
      const specialId = randomUUID(), eventName = `${name} special`
      await query("INSERT INTO public.special_events(id,church_id,name,event_date,created_by) VALUES($1,$2,$3,$4,$5)", [specialId, church, eventName, date, minister])
      const state = await mutate({ action: 'add', songId: songs[0], ministerId: minister }, '0', db, actor, church, eventName)
      const result = await mutate({ action: 'deleteEvent', eventId: specialId }, state.revision, db, actor, church, eventName)
      assert.equal(result.total, 0)
      assert.notEqual(result.revision, state.revision)
      await assert.rejects(mutate({ action: 'add', songId: songs[1], ministerId: minister }, state.revision, db, actor, church, eventName), /WF07_CONFLICT/)
      assert.equal((await query('SELECT id FROM public.special_events WHERE id=$1', [specialId])).rowCount, 0)
      contiguous(await read())
    })
  } finally {
    // Only synthetic fixture church IDs; never clear unrelated local data.
    await query('BEGIN')
    try {
      await query("SELECT set_config('wf07.writing','on',true)")
      await query("SELECT set_config('wf04.maintenance','on',true)")
      await query('DELETE FROM public.repertoire WHERE church_id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('DELETE FROM public.repertoire_sequences WHERE church_id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('DELETE FROM public.special_events WHERE church_id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('DELETE FROM public.songs WHERE church_id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('DELETE FROM public.ministers WHERE church_id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('DELETE FROM public.platform_admins WHERE user_id=$1', [actor])
      await query('DELETE FROM public.churches WHERE id=ANY($1::uuid[])', [[church, otherChurch]])
      await query('COMMIT')
    } catch (error) { await query('ROLLBACK'); throw error }
    finally {
      for (const user of users) await admin.auth.admin.deleteUser(user)
      await db.end()
      await db2.end()
    }
  }
})
