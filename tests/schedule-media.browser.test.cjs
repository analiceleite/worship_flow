// Opt-in ONLY against the dedicated, synthetic Compose test stack on loopback.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = require('playwright-core')

test('WF-11 browser: media navigation, published schedule, preparation, errors and empty states', {
  skip: process.env.WF11_BROWSER_TEST !== 'true', timeout: 360000,
}, async t => {
  const compose = fs.readFileSync(path.join(__dirname, '../compose.yaml'), 'utf8')
  const serviceKey = /^x-service-key: &service-key (.+)$/m.exec(compose)[1].trim()
  const admin = createClient('http://127.0.0.1:54321', serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new Client({ connectionString: 'postgres://postgres:worship-flow-compose-local-password@127.0.0.1:54322/postgres' })
  await db.connect()
  const church = randomUUID(), otherChurch = randomUUID(), actor = randomUUID(), minister = randomUUID(), peer = randomUUID()
  const published = randomUUID(), draft = randomUUID(), foreign = randomUUID()
  const email = `${actor}@wf11.browser.local.test`, password = `Aa1!${randomUUID()}`
  const nextSunday = new Date()
  while (nextSunday.getDay() !== 0) nextSunday.setDate(nextSunday.getDate() + 1)
  const dateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const eventDate = dateString(nextSunday)
  const nextWeek = new Date(nextSunday); nextWeek.setDate(nextWeek.getDate() + 7)
  const rehearsalDay = new Date(nextSunday); rehearsalDay.setDate(rehearsalDay.getDate() - 1)
  const rehearsalDate = dateString(rehearsalDay)
  const base = 'http://127.0.0.1:3001'
  const query = (sql, values) => db.query(sql, values)
  let browser, context, created = false, fixtures = false
  try {
    // This pre-existing marker identifies the isolated worship-flow-wf07-test stack,
    // NOT the ordinary local development database. No marker is set by this test.
    assert.equal((await query("SELECT current_setting('wf07.browser_test',true) AS enabled")).rows[0].enabled, 'on', 'Refusing a database without the dedicated test marker')
    assert.equal((await query("SELECT 1 FROM pg_policies WHERE policyname='wf11_quarters_read'")).rowCount, 1, 'Apply local migration 037 first')
    const result = await admin.auth.admin.createUser({ id: actor, email, password, email_confirm: true })
    assert.equal(result.error, null); created = true
    await query('BEGIN')
    try {
      await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1,'WF11 browser',$1::uuid::text,'test','disabled'),($2,'WF11 other browser',$2::uuid::text,'test','disabled')", [church, otherChurch])
      await query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,is_active,email_reminders_enabled) VALUES($1,$2,$3,'Mídia WF11','midia','Sonoplasta',true,false)", [minister, actor, church])
      await query("INSERT INTO public.ministers(id,church_id,name,role,instrument,is_active,email_reminders_enabled) VALUES($1,$2,'Colega WF11','midia','Sonoplasta',true,false)", [peer, church])
      for (const [id, tenant, isPublished] of [[published, church, true], [draft, church, false], [foreign, otherChurch, true]]) {
        await query("INSERT INTO public.schedule_quarters(id,church_id,name,start_date,end_date,is_published,sunday_arrival_time,sunday_service_time) VALUES($1,$2,'WF11 período browser','2000-01-01','2099-12-31',$3,'16:15','18:45')", [id, tenant, isPublished])
      }
      const roleId = (await query("SELECT id FROM public.schedule_roles WHERE category='midia' ORDER BY display_order LIMIT 1")).rows[0].id
      for (const [who, date] of [[minister, eventDate], [peer, dateString(nextWeek)]]) {
        await query("INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,minister_id,event_date,event_type) VALUES($1,$2,$3,$4,$5,'sunday')", [church, published, roleId, who, date])
      }
      await query("INSERT INTO public.schedule_rehearsals(church_id,quarter_id,event_date,event_type,rehearsal_date,rehearsal_time,rehearsal_place) VALUES($1,$2,$3,'sunday',$4,'19:25','Sala WF11')", [church, published, eventDate, rehearsalDate])
      await query('COMMIT'); fixtures = true
    } catch (error) { await query('ROLLBACK'); throw error }

    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.setDefaultNavigationTimeout(90000) // Allow first compilation in the local dev container.
    async function request(endpoint, method = 'GET', data) {
      try {
        return await page.request.fetch(`${base}${endpoint}`, { method, data, timeout: 90000 })
      } catch {
        // Playwright's raw request errors include session cookies; never publish them.
        throw new Error(`Local request failed: ${method} ${endpoint}`)
      }
    }
    await page.goto(`${base}/auth/login`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('**/repertoire')

    async function openSchedule() {
      await page.goto(`${base}/schedule`)
      await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).waitFor()
    }
    await t.test('desktop menu, personal entry, actual times and rehearsal on its own day', async () => {
      const menu = page.getByRole('link').filter({ hasText: 'Escala' })
      await menu.first().click()
      await page.waitForURL('**/schedule')
      const mine = page.getByRole('tab', { name: 'Meus compromissos', exact: true })
      assert.equal(await mine.getAttribute('aria-selected'), 'true')
      await page.getByText('Sala WF11', { exact: false }).waitFor()
      const text = await page.locator('main').innerText()
      assert.match(text, /Chegada: 16:15.*Início do culto: 18:45/)
      assert.match(text, /19:25/)
      assert.ok(text.includes(`${String(rehearsalDay.getDate()).padStart(2, '0')}/${String(rehearsalDay.getMonth() + 1).padStart(2, '0')}`))
      await page.getByRole('tab', { name: 'Escala Geral', exact: true }).click()
      await page.getByRole('tab', { name: 'Domingos', exact: true }).click()
      await page.getByText('Colega WF11', { exact: true }).filter({ visible: true }).first().waitFor()
      assert.equal(await page.getByRole('button', { name: /Editar ensaio|Adicionar ensaio|Salvar ensaio/ }).count(), 0)
      await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await mine.getAttribute('aria-selected'), 'true')
    })
    await t.test('direct API calls cannot read drafts/other church or mutate the schedule', async () => {
      for (const id of [draft, foreign, randomUUID()]) {
        assert.equal((await request(`/api/schedule/rehearsal?quarter_id=${id}`)).status(), 404)
        assert.equal((await request(`/api/schedule/quarters/${id}/assignments`)).status(), 404)
      }
      const list = await request('/api/schedule/quarters').then(r => r.json())
      assert.deepEqual(list.quarters.map(q => q.id), [published])
      for (const [endpoint, method, data] of [
        ['/api/schedule/assignment', 'PATCH', {}], ['/api/schedule/quarters', 'POST', {}],
        [`/api/schedule/quarters/${published}/publish`, 'PATCH', { is_published: true }],
        [`/api/schedule/quarters/${published}/import/apply`, 'POST', { items: [] }],
        [`/api/schedule/quarters/${published}`, 'DELETE', {}],
        ['/api/schedule/rehearsal', 'PATCH', { quarter_id: published, event_date: eventDate, event_type: 'sunday' }],
      ]) assert.equal((await request(endpoint, method, data)).status(), 403, endpoint)
      await page.goto(`${base}/schedule/admin/builder`)
      assert.ok(!new URL(page.url()).pathname.startsWith('/schedule/admin'))
    })
    await t.test('mobile menu at 360px, direct notice destination and no edit controls', async () => {
      await page.setViewportSize({ width: 360, height: 800 })
      await page.goto(`${base}/repertoire`)
      await page.getByRole('button', { name: /menu/i }).click()
      await page.getByRole('dialog').getByRole('link').filter({ hasText: 'Escala' }).click()
      await page.waitForURL('**/schedule')
      await page.getByText('Sala WF11', { exact: false }).waitFor()
      await page.getByRole('tab', { name: 'Escala Geral', exact: true }).click()
      await page.getByText('No celular, a escala geral mostra as datas de hoje em diante.', { exact: true }).waitFor()
      await openSchedule() // Same destination as the existing email notice.
      assert.equal(await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).getAttribute('aria-selected'), 'true')
    })
    await t.test('main failure is not an empty publication and retry recovers', async () => {
      await page.route('**/api/schedule/current', route => route.fulfill({ status: 500, json: { error: 'Falha WF11 simulada' } }), { times: 1 })
      await page.reload()
      await page.getByText('Falha WF11 simulada', { exact: false }).waitFor()
      assert.equal(await page.getByText('Nenhuma escala publicada', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
      await page.getByText('Sala WF11', { exact: false }).waitFor()
    })
    await t.test('auxiliary failure keeps schedule and retry restores preparation', async () => {
      await page.route('**/api/schedule/rehearsal?**', route => route.fulfill({ status: 500, json: { error: 'Falha auxiliar' } }), { times: 1 })
      await page.reload()
      await page.getByText('Não foi possível carregar as informações de ensaio.', { exact: false }).waitFor()
      assert.match(await page.locator('main').innerText(), /Chegada: 16:15/)
      assert.equal(await page.getByText('Ensaio: informações não cadastradas', { exact: true }).count(), 0)
      await page.getByRole('tab', { name: 'Escala Geral', exact: true }).click()
      await page.getByRole('tab', { name: 'Domingos', exact: true }).click()
      assert.equal(await page.getByText('Ensaio não informado', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Tentar carregar ensaios novamente', exact: true }).click()
      await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).click()
      await page.getByText('Sala WF11', { exact: false }).waitFor()
    })
    await t.test('late response from an abandoned visit cannot replace the current schedule', async () => {
      const snapshot = await request('/api/schedule/current').then(r => r.json())
      snapshot.schedule.quarter.name = 'Resposta antiga WF11'
      let release, received, finish
      const gate = new Promise(resolve => { release = resolve })
      const arrived = new Promise(resolve => { received = resolve })
      const finished = new Promise(resolve => { finish = resolve })
      await page.route('**/api/schedule/current', async route => {
        received()
        await gate
        try { await route.fulfill({ status: 200, json: snapshot }) } catch { /* Navigation cancelled the request. */ }
        finally { finish() }
      }, { times: 1 })
      try {
        await page.goto(`${base}/schedule`, { waitUntil: 'domcontentloaded' })
        await arrived
        await page.goto(`${base}/repertoire`)
        await openSchedule()
        await page.getByText('Sala WF11', { exact: false }).waitFor()
      } finally { release() }
      await finished
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.getByText('Resposta antiga WF11', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).getAttribute('aria-selected'), 'true')
    })
    await t.test('published without personal assignments stays personal and offers general view', async () => {
      await query('UPDATE public.schedule_assignments SET minister_id=null WHERE quarter_id=$1 AND minister_id=$2', [published, minister])
      await openSchedule()
      await page.getByText('Você não possui atribuições neste período publicado.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('tab', { name: 'Meus compromissos', exact: true }).getAttribute('aria-selected'), 'true')
      await page.getByRole('tab', { name: 'Escala Geral', exact: true }).click()
      await page.getByRole('tab', { name: 'Domingos', exact: true }).click()
      await page.getByText('Colega WF11', { exact: true }).filter({ visible: true }).first().waitFor()
    })
    await t.test('past-only assignments are distinct from no assignment/publication', async () => {
      await query("INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,minister_id,event_date,event_type) SELECT $1,$2,id,$3,'2000-01-02','sunday' FROM public.schedule_roles WHERE category='midia' LIMIT 1", [church, published, minister])
      await openSchedule()
      await page.getByText('Você não possui próximos compromissos neste período publicado.', { exact: true }).waitFor()
    })
    await t.test('no publication is distinct; anonymous direct link is protected', async () => {
      await query('UPDATE public.schedule_quarters SET is_published=false WHERE id=$1', [published])
      await page.reload()
      await page.getByText('Nenhuma escala publicada', { exact: true }).waitFor()
      const anonymous = await browser.newContext()
      try {
        const publicPage = await anonymous.newPage()
        await publicPage.goto(`${base}/schedule`)
        assert.equal(new URL(publicPage.url()).pathname, '/auth/login')
      } finally { await anonymous.close() }
    })
  } finally {
    await context?.close(); await browser?.close()
    try {
      if (fixtures) {
        await query('BEGIN')
        try {
          for (const table of ['schedule_rehearsals', 'schedule_assignments', 'schedule_quarters', 'ministers', 'churches']) {
            await query(`DELETE FROM public.${table} WHERE ${table === 'churches' ? 'id' : 'church_id'}=ANY($1::uuid[])`, [[church, otherChurch]])
          }
          await query('COMMIT')
        } catch (error) { await query('ROLLBACK'); throw error }
      }
    } finally {
      if (created) await admin.auth.admin.deleteUser(actor)
      await db.end()
    }
  }
})
