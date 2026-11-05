// Opt-in, isolated Compose ONLY. All identities and repertoire rows are synthetic.
// Start project worship-flow-wf07-test, then set WF07_BROWSER_TEST=true.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = require('playwright-core')

test('WF-07 browser: pagination, global ordering, conflicts, WhatsApp and mobile', {
  skip: process.env.WF07_BROWSER_TEST !== 'true', timeout: 180000,
}, async t => {
  // Only committed, public Compose test credentials; never load .env files.
  const compose = fs.readFileSync(path.join(__dirname, '../compose.yaml'), 'utf8')
  const serviceKey = /^x-service-key: &service-key (.+)$/m.exec(compose)[1].trim()
  const admin = createClient('http://127.0.0.1:54321', serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new Client({ connectionString: 'postgres://postgres:worship-flow-compose-local-password@127.0.0.1:54322/postgres' })
  await db.connect()
  const church = randomUUID(), actor = randomUUID(), minister = randomUUID(), special = randomUUID()
  const email = `${actor}@browser.local.test`, password = `Aa1!${randomUUID()}`
  const now = new Date()
  while (![0, 4].includes(now.getDay())) now.setDate(now.getDate() + 1)
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const eventName = now.getDay() === 4 ? 'Culto de Quinta' : 'Culto de Domingo'
  const songs = Array.from({ length: 26 }, () => randomUUID())
  let browser, context
  const query = (sql, args) => db.query(sql, args)
  try {
    // Fail before fixtures if this is not the dedicated test database/project.
    const marker = await query("SELECT current_setting('wf07.browser_test',true) AS enabled")
    assert.equal(marker.rows[0].enabled, 'on', 'Enable the dedicated local DB marker before browser tests; never use the existing development DB.')
    const created = await admin.auth.admin.createUser({ id: actor, email, password, email_confirm: true })
    assert.equal(created.error, null)
    await query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1,'WF07 browser',$1::uuid::text,'test','disabled')", [church])
    await query("INSERT INTO public.ministers(id,user_id,church_id,name,role,instrument,is_active,email_reminders_enabled) VALUES($1,$2,$3,'Admin browser','admin','Voz',true,false)", [minister, actor, church])
    await query("INSERT INTO public.special_events(id,church_id,name,event_date,created_by) VALUES($1,$2,'Evento vazio browser',$3,$4)", [special, church, date, minister])
    let revision = '0'
    for (let i = 0; i < songs.length; i++) {
      await query("INSERT INTO public.songs(id,church_id,minister_id,title,artist,tone) VALUES($1,$2,$3,$4,'Artista teste','D')", [songs[i], church, minister, `WF07 música ${String(i + 1).padStart(2, '0')}`])
      if (i < 25) {
        const result = await query('SELECT public.wf07_mutate($1,$2,false,$3,$4,$5,$6) AS snapshot', [actor, church, date, eventName, revision, JSON.stringify({ action: 'add', songId: songs[i], ministerId: minister })])
        revision = result.rows[0].snapshot.revision
      }
    }
    await query("UPDATE public.songs SET cifra_content=ARRAY['Cifra fictícia WF07','D G A'] WHERE id=$1", [songs[0]])
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const exports = []
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname === 'wa.me') {
        exports.push(url.searchParams.get('text'))
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp intercepted locally</p>' })
      }
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
      return route.abort() // No external services in tests.
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    await page.goto('http://127.0.0.1:3001/auth/login')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('**/users')
    await page.goto('http://127.0.0.1:3001/repertoire')
    await page.getByText('WF07 música 01', { exact: true }).waitFor()
    const pagination = page.getByRole('navigation', { name: 'pagination' })
    await t.test('cifra text loads on demand in the list and in the player', async () => {
      await page.getByRole('button', { name: 'Ver cifra no app', exact: true }).click()
      await page.getByText('Cifra fictícia WF07', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Playlist', exact: true }).click()
      await page.waitForURL('**/repertoire/player?**')
      await page.getByText('Cifra fictícia WF07', { exact: true }).waitFor()
      await page.goto('http://127.0.0.1:3001/repertoire')
      await page.getByText('WF07 música 01', { exact: true }).waitFor()
    })
    await t.test('25 items, global movement between pages and keyboard controls', async () => {
      assert.match(await page.locator('main').innerText(), /25 músicas/i)
      await page.getByRole('button', { name: 'Ordenar', exact: true }).click()
      const move = page.getByRole('button', { name: 'Mover WF07 música 10 para baixo', exact: true })
      await move.focus()
      await page.keyboard.press('Enter')
      await pagination.locator('[aria-current="page"]').filter({ hasText: '2' }).waitFor()
      assert.equal(await page.locator('[data-reorder-index="10"]').innerText().then(text => text.includes('WF07 música 10')), true)
      await page.getByRole('button', { name: 'Mover WF07 música 10 para cima', exact: true }).click()
      await pagination.locator('[aria-current="page"]').filter({ hasText: '1' }).waitFor()
    })
    await t.test('adding from page 3 uses global end and excludes already added songs', async () => {
      await pagination.getByRole('link', { name: '3', exact: true }).click()
      await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('combobox').nth(0).click()
      await page.getByRole('option', { name: 'Admin browser (Voz)', exact: true }).click()
      await dialog.getByRole('combobox').nth(1).click()
      assert.equal(await page.getByRole('option').count(), 1)
      await page.getByRole('option', { name: 'WF07 música 26 — Artista teste (D)', exact: true }).click()
      await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click()
      await page.getByText('WF07 música 26', { exact: true }).waitFor()
      assert.match(await page.locator('[data-reorder-index="25"]').innerText(), /26/)
    })
    async function exportFromPage() {
      const popupPromise = page.waitForEvent('popup')
      await page.getByRole('button', { name: 'Exportar p/ WhatsApp', exact: true }).click()
      const popup = await popupPromise
      await popup.waitForURL('https://wa.me/**')
      await popup.close()
    }
    await t.test('export from pages 1 and 3 is complete and identical without contacting WhatsApp', async () => {
      await exportFromPage()
      await pagination.getByRole('link', { name: '1', exact: true }).click()
      await exportFromPage()
      assert.equal(exports.length, 2)
      assert.equal(exports[0], exports[1])
      assert.equal(exports[0].split('\n').length, 28)
      assert.match(exports[0], /26\. WF07 música 26/)
    })
    await t.test('concurrent edit warns and refreshes rather than overwriting', async () => {
      const state = await page.request.get(`http://127.0.0.1:3001/api/repertoire?${new URLSearchParams({ date, eventName })}`).then(r => r.json())
      await page.request.post('http://127.0.0.1:3001/api/repertoire', { data: { date, eventName, expectedRevision: state.revision,
        command: { action: 'move', itemId: state.items[0].id, position: 2 } } })
      await page.getByRole('button', { name: 'Mover WF07 música 01 para baixo', exact: true }).click()
      await page.getByText('O repertório foi alterado por outra pessoa. Confira a lista atualizada e tente novamente.', { exact: true }).waitFor()
      assert.match(await page.locator('[data-reorder-index="0"]').innerText(), /WF07 música 02/)
    })
    await t.test('switching event from page 3 resets to a real empty event, then page 1', async () => {
      await pagination.getByRole('link', { name: '3', exact: true }).click()
      await page.getByRole('button', { name: 'Evento vazio browser', exact: true }).click()
      await page.getByText('Nenhuma música ainda', { exact: true }).waitFor()
      assert.equal(await pagination.count(), 0)
      await page.getByRole('button', { name: eventName, exact: true }).click()
      await page.getByText('WF07 música 02', { exact: true }).waitFor()
      assert.equal(await pagination.locator('[aria-current="page"]').innerText(), '1')
    })
    await t.test('mobile menu exports the same full repertoire and arrow controls remain available', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.getByRole('button', { name: 'Mover WF07 música 02 para baixo', exact: true }).isVisible(), true)
      await page.getByRole('button', { name: 'Ações', exact: true }).click()
      const popupPromise = page.waitForEvent('popup')
      await page.getByRole('menuitem', { name: 'Exportar p/ WhatsApp', exact: true }).click()
      const popup = await popupPromise
      await popup.waitForURL('https://wa.me/**')
      await popup.close()
      assert.match(exports.at(-1), /26\. WF07 música 26/)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    })
    await t.test('failed export does not open a partial WhatsApp message', async () => {
      const count = exports.length
      await page.route('**/api/repertoire?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada de exportação' }) }))
      await page.getByRole('button', { name: 'Ações', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Exportar p/ WhatsApp', exact: true }).click()
      await page.getByText('Falha simulada de exportação', { exact: true }).waitFor()
      assert.equal(exports.length, count)
      await page.unroute('**/api/repertoire?**')
    })
    await t.test('deleting the final items on page 3 clamps to page 2 without a false empty state', async () => {
      await pagination.getByRole('link', { name: '3', exact: true }).click()
      for (let number = 26; number >= 21; number--) {
        await page.getByRole('button', { name: `Remover WF07 música ${number}`, exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Remover', exact: true }).click()
        await page.getByRole('button', { name: `Remover WF07 música ${number}`, exact: true }).waitFor({ state: 'detached' })
      }
      assert.equal(await pagination.locator('[aria-current="page"]').innerText(), '2')
      assert.match(await page.locator('main').innerText(), /20 músicas/i)
      assert.equal(await page.getByText('Nenhuma música ainda', { exact: true }).count(), 0)
    })
    await t.test('week changes reset pagination while preserving the selected event data', async () => {
      await page.getByRole('button', { name: 'Próxima semana', exact: true }).click()
      await page.getByText('WF07 música 02', { exact: true }).waitFor()
      assert.equal(await pagination.locator('[aria-current="page"]').innerText(), '1')
      await page.getByRole('button', { name: 'Semana anterior', exact: true }).click()
      await page.getByText('WF07 música 02', { exact: true }).waitFor()
    })
    await t.test('late responses for a previous event cannot overwrite the current event', async () => {
      await page.setViewportSize({ width: 1280, height: 900 })
      let release
      const barrier = new Promise(resolve => { release = resolve })
      await page.route('**/api/repertoire?**', async route => {
        if (new URL(route.request().url()).searchParams.get('eventName') !== eventName) return route.continue()
        const response = await route.fetch()
        await barrier
        await route.fulfill({ response })
      })
      try {
        const pending = page.waitForRequest(request => request.url().includes('/api/repertoire?') && new URL(request.url()).searchParams.get('eventName') === eventName)
        await page.getByRole('button', { name: eventName, exact: true }).click()
        await pending
        await page.getByRole('button', { name: 'Evento vazio browser', exact: true }).click()
        await page.getByText('Nenhuma música ainda', { exact: true }).waitFor()
        const response = page.waitForResponse(result => result.url().includes('/api/repertoire?') && new URL(result.url()).searchParams.get('eventName') === eventName)
        release()
        await (await response).finished()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.equal(await page.locator('[data-reorder-index]').count(), 0)
        assert.equal(await page.getByText('Nenhuma música ainda', { exact: true }).isVisible(), true)
      } finally { release(); await page.unroute('**/api/repertoire?**') }
    })
  } finally {
    await context?.close()
    await browser?.close()
    await query('BEGIN')
    try {
      await query("SELECT set_config('wf07.writing','on',true)")
      await query('DELETE FROM public.repertoire WHERE church_id=$1', [church])
      await query('DELETE FROM public.repertoire_sequences WHERE church_id=$1', [church])
      await query('DELETE FROM public.special_events WHERE church_id=$1', [church])
      await query('DELETE FROM public.songs WHERE church_id=$1', [church])
      await query('DELETE FROM public.ministers WHERE church_id=$1', [church])
      await query('DELETE FROM public.churches WHERE id=$1', [church])
      await query('COMMIT')
    } catch (error) { await query('ROLLBACK'); throw error }
    finally { await admin.auth.admin.deleteUser(actor); await db.end() }
  }
})
