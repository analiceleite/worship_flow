// Opt-in, dedicated synthetic Compose stack only (WF04_BROWSER_TEST=true).
// Drives the real invitation journey: admin invites, the e-mail is captured by
// Mailpit, the invitee creates an account, confirms through GoTrue's own verify
// link, and accepts. Fixtures are committed for the browser, then removed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { Client } = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = require('playwright-core')

const MAILPIT = 'http://127.0.0.1:54324/api/v1'
const GOTRUE = 'http://127.0.0.1:54321'

async function waitForMail(to, subjectPattern, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const list = await (await fetch(`${MAILPIT}/messages?limit=50`)).json()
    const hit = (list.messages ?? []).find(message =>
      message.To?.some(recipient => recipient.Address === to) && subjectPattern.test(message.Subject ?? ''))
    if (hit) {
      const full = await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json()
      return `${full.Text ?? ''}\n${full.HTML ?? ''}`
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`No ${subjectPattern} message captured for ${to}`)
}

test('WF-04 browser: invite, create account, confirm, accept', {
  skip: process.env.WF04_BROWSER_TEST !== 'true', timeout: 600000,
}, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../compose.yaml'), 'utf8')
  const key = /^x-service-key: &service-key (.+)$/m.exec(source)[1].trim()
  const admin = createClient(GOTRUE, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const db = new Client({ connectionString: 'postgres://postgres:worship-flow-compose-local-password@127.0.0.1:54322/postgres' })
  await db.connect()

  const church = randomUUID(), adminId = randomUUID()
  const inviteeEmail = `invitee-${randomUUID().slice(0, 8)}@wf04.browser.local.test`
  const adminEmail = `${adminId}@wf04.browser.local.test`
  const password = `Aa1!${randomUUID()}`
  const base = 'http://127.0.0.1:3001'
  const churchName = `WF04 convite ${church.slice(0, 8)}`
  const contexts = []
  let browser
  let inviteeId = null
  let committed = false

  async function openPage() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    contexts.push(context)
    await context.routeWebSocket('**/_next/webpack-hmr*', socket => socket.close())
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.setDefaultNavigationTimeout(90000)
    return page
  }

  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
    assert.equal((await db.query("SELECT to_regclass('public.wf04_invitations') AS ready")).rows[0].ready !== null, true)

    const created = await admin.auth.admin.createUser({ id: adminId, email: adminEmail, password, email_confirm: true })
    assert.equal(created.error, null)
    await db.query("INSERT INTO public.churches(id,name,slug,environment,email_mode) VALUES($1::uuid,$2,$1::uuid::text,'test','disabled')", [church, churchName])
    await db.query("INSERT INTO public.ministers(id,user_id,church_id,name,email,role,instrument,access_state) VALUES($1,$1,$2,'Admin WF04 browser',$3,'admin','Voz','active')", [adminId, church, adminEmail])
    await db.query("INSERT INTO public.user_profiles(user_id,name) VALUES($1,'Admin WF04 browser')", [adminId])
    committed = true

    // 1. Administrator invites from the team screen.
    const adminPage = await openPage()
    await adminPage.goto(`${base}/auth/login`)
    await adminPage.getByLabel('Email', { exact: true }).fill(adminEmail)
    await adminPage.getByLabel('Senha', { exact: true }).fill(password)
    await Promise.all([
      adminPage.waitForURL('**/users', { waitUntil: 'domcontentloaded' }),
      adminPage.getByRole('button', { name: 'Entrar', exact: true }).click(),
    ])
    await adminPage.goto(`${base}/users`)
    await adminPage.getByRole('heading', { name: 'Convites' }).waitFor()
    await adminPage.getByRole('button', { name: 'Novo Ministro' }).first().click()
    await adminPage.getByLabel('Nome', { exact: true }).fill('Convidada WF04')
    await adminPage.getByLabel('Email', { exact: true }).fill(inviteeEmail)
    await adminPage.getByRole('button', { name: 'Enviar convite', exact: true }).click()
    await adminPage.getByText(`Convite enviado para ${inviteeEmail}`).or(adminPage.getByText(`Convite registrado para ${inviteeEmail}`)).waitFor()
      .catch(async error => {
        const alerts = await adminPage.locator('[role="alert"], [data-slot="alert"]').allInnerTexts().catch(() => [])
        throw new Error(`Invite submission did not confirm. Alerts: ${JSON.stringify(alerts)}`, { cause: error })
      })
    await adminPage.getByRole('button', { name: 'Fechar', exact: true }).click()
    await adminPage.getByText(inviteeEmail).first().waitFor()

    // 2. The invitation e-mail is captured and points only to the invitation route.
    const invitationMail = await waitForMail(inviteeEmail, /Convite para/)
    const link = /http:\/\/127\.0\.0\.1:3001\/auth\/invite\/([A-Za-z0-9_-]{40,128})/.exec(invitationMail)
    assert.ok(link, 'invitation link captured')
    const inviteUrl = link[0]

    // 2b. The signed-in administrator is not the invitee: the page must block acceptance.
    await adminPage.goto(inviteUrl)
    await adminPage.getByText('como outra conta').waitFor()
    assert.equal(await adminPage.getByRole('button', { name: 'Aceitar convite', exact: true }).count(), 0)

    // 3. The invitee opens the link anonymously, creates the account and gets a confirmation.
    const inviteePage = await openPage()
    await inviteePage.goto(inviteUrl)
    await inviteePage.getByText(`Convite para participar`).or(inviteePage.getByText(churchName)).first().waitFor()
    await inviteePage.getByLabel('Seu nome', { exact: true }).fill('Convidada WF04')
    await inviteePage.getByLabel('Crie uma senha', { exact: true }).fill(password)
    await inviteePage.getByRole('button', { name: 'Criar conta e aceitar', exact: true }).click()
    await inviteePage.getByText('Enviamos um e-mail de confirmação').waitFor()
    inviteeId = (await db.query('SELECT id FROM auth.users WHERE email=$1', [inviteeEmail])).rows[0].id

    // Accepting before confirmation must not create a membership.
    const beforeConfirm = await db.query('SELECT count(*)::int AS c FROM public.ministers WHERE user_id=$1', [inviteeId])
    assert.equal(beforeConfirm.rows[0].c, 0)

    // 4. Confirmation uses GoTrue's own verify link, not a database shortcut.
    const confirmMail = await waitForMail(inviteeEmail, /Confirm/i)
    const verify = /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify[^\s"'<>]+/.exec(confirmMail)
    assert.ok(verify, 'confirmation link captured')
    const verified = await fetch(verify[0], { redirect: 'manual' })
    assert.ok(verified.status >= 300 && verified.status < 400, 'GoTrue verifies and redirects')

    // 5. Return through the same invitation, sign in and accept.
    await inviteePage.goto(inviteUrl)
    await inviteePage.getByRole('button', { name: 'Já tenho conta', exact: true }).click()
    await inviteePage.getByLabel('E-mail da conta', { exact: true }).fill(inviteeEmail)
    await inviteePage.getByLabel('Senha', { exact: true }).fill(password)
    await Promise.all([
      inviteePage.waitForURL('**/songs', { waitUntil: 'domcontentloaded' }),
      inviteePage.getByRole('button', { name: 'Entrar e aceitar', exact: true }).click(),
    ])

    // 6. Database evidence: one active membership, invitation consumed, replay is idempotent.
    const membership = await db.query('SELECT church_id, access_state, role FROM public.ministers WHERE user_id=$1', [inviteeId])
    assert.deepEqual(membership.rows, [{ church_id: church, access_state: 'active', role: 'minister' }])
    const consumed = await db.query('SELECT accepted_at IS NOT NULL AS accepted FROM public.wf04_invitations WHERE church_id=$1 AND email=$2', [church, inviteeEmail])
    assert.equal(consumed.rows[0].accepted, true)

    const replay = await openPage()
    await replay.goto(inviteUrl)
    await replay.getByText('Convite já aceito').waitFor()
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
    if (committed) {
      await db.query('BEGIN')
      await db.query("SELECT set_config('wf04.maintenance','on',true)")
      await db.query('DELETE FROM public.ministers WHERE church_id=$1', [church]).catch(() => undefined)
      await db.query('DELETE FROM public.churches WHERE id=$1', [church]).catch(() => undefined)
      await db.query('DELETE FROM public.user_profiles WHERE user_id = ANY($1::uuid[])', [[adminId, ...(inviteeId ? [inviteeId] : [])]]).catch(() => undefined)
      await db.query('COMMIT')
      for (const id of [adminId, inviteeId].filter(Boolean)) await admin.auth.admin.deleteUser(id).catch(() => undefined)
    }
    await db.end()
  }
})
