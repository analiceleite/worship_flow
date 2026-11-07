// Opt-in, dedicated synthetic Compose stack only. Never loads .env credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = require('playwright-core')

test('WF-04 browser: global profile, local access and preserved identity', {
  skip: process.env.WF04_BROWSER_TEST !== 'true', timeout: 300000,
}, async t => {
  const source = fs.readFileSync(path.join(__dirname, '../compose.yaml'), 'utf8')
  const key = /^x-service-key: &service-key (.+)$/m.exec(source)[1].trim()
  const admin = createClient('http://127.0.0.1:54321', key, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new Client({ connectionString: 'postgres://postgres:worship-flow-compose-local-password@127.0.0.1:54322/postgres' })
  await db.connect()
  const church = randomUUID(), other = randomUUID(), actor = randomUUID(), peer = randomUUID(), foreign = randomUUID()
  const password = `Aa1!${randomUUID()}`, base = 'http://127.0.0.1:3001'
  const created = [], contexts = []
  let browser, fixtures = false
  async function login(id, destination) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    contexts.push(context)
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.setDefaultNavigationTimeout(90000)
    await page.goto(`${base}/auth/login`)
    await page.getByLabel('Email', { exact: true }).fill(`${id}@wf04.browser.local.test`)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL(`**/${destination}`)
    return page
  }
  async function request(page, endpoint, method = 'GET', body) {
    try {
      const response = await page.request.fetch(`${base}${endpoint}`, {
        method, headers: { Origin: base }, data: body, timeout: 90000,
      })
      return { status: response.status(), body: await response.json() }
    } catch {
      // Raw Playwright request errors can include session cookies.
      throw new Error(`Local browser API request failed: ${method} ${endpoint}`)
    }
  }
  try {
    assert.equal((await db.query("SELECT current_setting('wf07.browser_test',true) AS enabled")).rows[0].enabled, 'on')
    assert.ok((await db.query("SELECT to_regclass('public.wf04_legacy_cutover') AS ready")).rows[0].ready)
    for (const id of [actor, peer, foreign]) {
      const result = await admin.auth.admin.createUser({ id, email: `${id}@wf04.browser.local.test`, password, email_confirm: true })
      assert.equal(result.error, null)
      created.push(id)
    }
    await db.query('BEGIN')
    try {
      await db.query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1::uuid,'WF04 browser',$1::uuid::text,'test','disabled'),($2::uuid,'WF04 other',$2::uuid::text,'test','disabled')", [church, other])
      for (const [id, tenant, name, role] of [[actor, church, 'Admin WF04', 'admin'], [peer, church, 'Integrante WF04', 'minister'], [foreign, other, 'Outra igreja WF04', 'minister']]) {
        await db.query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,access_state,email_reminders_enabled) VALUES($1,$1,$2,$3,$4,'Voz','active',false)", [id, tenant, name, role])
        await db.query('INSERT INTO public.user_profiles(user_id,name) VALUES($1,$2)', [id, name])
      }
      await db.query('COMMIT'); fixtures = true
    } catch (error) { await db.query('ROLLBACK'); throw error }
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
    const page = await login(actor, 'users')
    const memberPage = await login(peer, 'songs')
    await t.test('profile name is self-edited, projected and reflected in header', async () => {
      await page.goto(`${base}/profile`)
      await page.getByLabel('Nome', { exact: true }).fill('Nome global WF04')
      const saving = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Salvar nome', exact: true }).click()
      assert.equal((await saving).status(), 200)
      await page.getByText('Nome atualizado.', { exact: true }).waitFor()
      assert.equal((await db.query('SELECT name FROM public.ministers WHERE id=$1', [actor])).rows[0].name, 'Nome global WF04')
      assert.ok(await page.getByText('Nome global WF04', { exact: true }).count() >= 1)
    })
    await t.test('photo belongs to the person and can be removed safely', async () => {
      await page.reload()
      await page.getByLabel('Nome', { exact: true }).waitFor()
      await page.getByLabel('Selecionar foto de perfil', { exact: true }).setInputFiles({
        name: 'avatar.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'),
      })
      const [uploaded] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/profile/avatar') && response.request().method() === 'POST', { timeout: 90000 }),
        page.getByRole('button', { name: 'Salvar foto', exact: true }).click(),
      ])
      assert.equal(uploaded.status(), 200)
      const profile = (await db.query('SELECT avatar_url FROM public.user_profiles WHERE user_id=$1', [actor])).rows[0]
      assert.ok(profile.avatar_url.includes(`/profile-avatars/${actor}/`))
      assert.equal((await db.query('SELECT avatar_url FROM public.ministers WHERE id=$1', [actor])).rows[0].avatar_url, profile.avatar_url)
      await page.getByRole('button', { name: 'Remover foto', exact: true }).waitFor()
      const removal = page.waitForResponse(response => response.url().endsWith('/api/profile/avatar') && response.request().method() === 'DELETE')
      await page.getByRole('button', { name: 'Remover foto', exact: true }).click()
      assert.equal((await removal).status(), 200)
    })
    await t.test('API rejects identity injection, cross-tenant access and last admin suspension', async () => {
      assert.equal((await request(page, '/api/profile', 'PATCH', { name: 'Invalid', user_id: peer })).status, 400)
      assert.equal((await request(page, `/api/ministers/${foreign}/access`, 'PATCH', { state: 'suspended' })).status, 404)
      assert.equal((await request(page, `/api/ministers/${actor}/access`, 'PATCH', { state: 'suspended' })).status, 409)
      assert.equal((await request(page, `/api/ministers/${peer}`, 'DELETE')).status, 409)
      assert.equal((await request(memberPage, `/api/ministers/${actor}/access`, 'PATCH', { state: 'suspended' })).status, 403)
    })
    await t.test('suspension UI preserves account/history and invalidates an existing session immediately', async () => {
      await page.goto(`${base}/users`)
      await page.getByRole('button', { name: 'Suspender acesso de Integrante WF04', exact: true }).click()
      await page.getByRole('button', { name: 'Suspender acesso', exact: true }).click()
      await page.getByRole('button', { name: 'Reativar acesso de Integrante WF04', exact: true }).waitFor()
      assert.equal((await request(memberPage, '/api/context')).status, 403)
      assert.equal((await admin.auth.admin.getUserById(peer)).data.user.id, peer)
      assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ministers WHERE id=$1', [peer])).rows[0].count, 1)
      await page.getByRole('button', { name: 'Reativar acesso de Integrante WF04', exact: true }).click()
      await page.getByRole('button', { name: 'Reativar acesso', exact: true }).click()
      await page.getByRole('button', { name: 'Suspender acesso de Integrante WF04', exact: true }).waitFor()
      assert.equal((await request(memberPage, '/api/context')).status, 200)
    })
    await t.test('profile form remains usable at 360px without horizontal overflow', async () => {
      await page.setViewportSize({ width: 360, height: 800 })
      await page.goto(`${base}/profile`)
      await page.getByLabel('Nome', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    })
  } finally {
    await Promise.all(contexts.map(context => context.close()))
    await browser?.close()
    try {
      if (fixtures) {
        const objects = await admin.storage.from('profile-avatars').list(actor)
        if (objects.data?.length) await admin.storage.from('profile-avatars').remove(objects.data.map(item => `${actor}/${item.name}`))
        await db.query('BEGIN')
        try {
          await db.query("SELECT set_config('wf04.maintenance','on',true)")
          await db.query('DELETE FROM public.membership_access_audit WHERE church_id=ANY($1::uuid[])', [[church, other]])
          await db.query('DELETE FROM public.ministers WHERE church_id=ANY($1::uuid[])', [[church, other]])
          await db.query('DELETE FROM public.user_profiles WHERE user_id=ANY($1::uuid[])', [[actor, peer, foreign]])
          await db.query('DELETE FROM public.churches WHERE id=ANY($1::uuid[])', [[church, other]])
          await db.query('COMMIT')
        } catch (error) { await db.query('ROLLBACK'); throw error }
      }
    } finally {
      for (const id of created) await admin.auth.admin.deleteUser(id)
      await db.end()
    }
  }
})
