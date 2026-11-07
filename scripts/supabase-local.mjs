import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { assertLocalUrl, buildLocalBaseline, localEnvironment } from './local-supabase-utils.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const cliPath = path.join(path.dirname(require.resolve('supabase/package.json')), 'dist/supabase.js')
const localDir = process.env.LOCAL_DOCKER === 'true' ? '/local' : path.join(root, 'supabase/.local')
const accountsFile = path.join(localDir, 'accounts.json')

function cli(args) {
  // This wrapper exposes only hard-coded local commands; never link, login, pull,
  // remote flags, db push or reset. Capture status keys instead of logging them.
  const result = spawnSync(process.execPath, [cliPath, ...args, '--workdir', root], {
    cwd: root, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', SUPABASE_ACCESS_TOKEN: '', SUPABASE_DB_PASSWORD: '' },
  })
  if (result.status !== 0) {
    fs.mkdirSync(localDir, { recursive: true })
    fs.writeFileSync(path.join(localDir, 'cli-error.log'), result.stderr || 'The local CLI did not finish successfully.')
    throw new Error('Local Supabase command failed. See supabase/.local/cli-error.log (do not publish this file).')
  }
  return result.stdout
}

function status() {
  if (process.env.LOCAL_DOCKER === 'true') {
    assertLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 54321)
    if (process.env.SUPABASE_INTERNAL_URL !== 'http://gateway:8000') throw new Error('Invalid local Compose transport')
    return { API_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
  }
  const value = JSON.parse(cli(['status', '-o', 'json']))
  assertLocalUrl(value.API_URL, 54321)
  return value
}

function prepare() {
  const directory = path.join(root, 'supabase/migrations')
  fs.mkdirSync(directory, { recursive: true })
  const baseline = buildLocalBaseline(fs.readFileSync(path.join(root, 'scripts/001_create_tables.sql'), 'utf8'))
  const generated = new Map([['20000101000001_local_baseline.sql', baseline]])
  for (const filename of fs.readdirSync(path.join(root, 'scripts')).sort()) {
    const match = /^(\d{3})_(.+\.sql)$/.exec(filename)
    if (!match || Number(match[1]) < 16) continue
    const target = `2000010100${String(Number(match[1])).padStart(4, '0')}_${match[2]}`
    generated.set(target, fs.readFileSync(path.join(root, 'scripts', filename), 'utf8'))
  }
  for (const [filename, sql] of generated) {
    const target = path.join(directory, filename)
    // Do not rewrite migration history that may have already been applied.
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== sql) {
      throw new Error(`Local migration source changed: ${filename}. Review a new incremental migration; no reset was performed.`)
    }
    fs.writeFileSync(target, sql)
  }
  console.log(`Prepared ${generated.size} local migrations. Production scripts were not changed.`)
}

async function seed() {
  const env = localEnvironment(status())
  const api = process.env.LOCAL_DOCKER === 'true' ? 'http://gateway:8000' : env.NEXT_PUBLIC_SUPABASE_URL
  const client = createClient(api, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const previous = fs.existsSync(accountsFile) ? JSON.parse(fs.readFileSync(accountsFile, 'utf8')) : []
  const definitions = [
    { email: 'admin@worship.local.test', name: 'Admin local', role: 'admin', slug: 'local-worship' },
    { email: 'vocal@worship.local.test', name: 'Vocal local', role: 'minister', slug: 'local-worship' },
    { email: 'midia@worship.local.test', name: 'Mídia local', role: 'midia', slug: 'local-worship' },
    { email: 'admin@other.local.test', name: 'Admin outra igreja local', role: 'admin', slug: 'local-other' },
  ]
  const accounts = []
  const savedAccounts = new Map(previous.map((account) => [account.email, account]))
  function saveAccount(account) {
    savedAccounts.set(account.email, account)
    fs.mkdirSync(localDir, { recursive: true })
    fs.writeFileSync(accountsFile, JSON.stringify([...savedAccounts.values()], null, 2) + '\n', { mode: 0o600 })
  }
  async function checked(operation) {
    const { data, error } = await operation
    if (error) throw new Error('Could not create synthetic local data. No remote project was accessed.')
    return data
  }
  // All fixtures use reserved .test addresses; no production dataset is imported.
  for (const definition of definitions) {
    const church = await checked(client.from('churches').upsert({
      slug: definition.slug, name: definition.slug, environment: 'test', email_mode: 'disabled', status: 'active',
    }, { onConflict: 'slug' }).select('id').single())
    const saved = previous.find((account) => account.email === definition.email)
    let user = saved?.userId ? (await client.auth.admin.getUserById(saved.userId)).data.user : null
    const password = saved?.password || randomBytes(18).toString('base64url') + 'aA1!'
    if (!user) {
      const result = await checked(client.auth.admin.createUser({ email: definition.email, password, email_confirm: true }))
      user = result.user
    }
    if (!user) throw new Error('Local user creation did not return a user.')
    saveAccount({ email: definition.email, password, userId: user.id })
    const existing = await checked(client.from('ministers').select('id').eq('user_id', user.id).maybeSingle())
    const globalProfile = await checked(client.from('user_profiles').select('name').eq('user_id', user.id).maybeSingle())
    const row = {
      user_id: user.id, church_id: church.id, email: definition.email, name: globalProfile?.name ?? definition.name,
      role: definition.role, instrument: definition.role === 'midia' ? 'Sonoplasta' : 'Voz', is_active: true, access_state: 'active',
      email_reminders_enabled: false,
    }
    const operation = existing
      ? client.from('ministers').update(row).eq('id', existing.id)
      : client.from('ministers').insert(row)
    const profile = await checked(operation.select('id').single())
    await checked(client.from('user_profiles').upsert({
      user_id: user.id, name: definition.name,
    }, { onConflict: 'user_id', ignoreDuplicates: true }))
    const account = { email: definition.email, password, userId: user.id, ministerId: profile.id, churchId: church.id }
    accounts.push(account)
    saveAccount(account)
  }
  await checked(client.from('churches').update({ environment: 'test', email_mode: 'disabled' }).eq('slug', 'worship-flow-default'))
  console.log(`Created 4 synthetic accounts across 2 churches. Credentials: ${process.env.LOCAL_DOCKER === 'true' ? '/local/accounts.json' : 'supabase/.local/accounts.json'} (local only).`)
}

function dev() {
  const env = localEnvironment(status(), process.env)
  // A separate dist directory avoids reusing production-configured client bundles.
  console.log('LOCAL application: http://127.0.0.1:3001 | emails: http://127.0.0.1:54324')
  console.log('Production .env.local is unchanged; local destinations override it in this process only.')
  const nextPath = require.resolve('next/dist/bin/next')
  const child = spawn(process.execPath, [nextPath, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3001'], {
    cwd: root, env, stdio: 'inherit',
  })
  child.on('error', () => { console.error('Could not start the local application.'); process.exitCode = 1 })
  child.on('exit', (code) => { process.exitCode = code ?? 1 })
}

function testRecovery() {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/password-recovery.local.test.cjs', 'tests/repertoire.local.test.cjs', 'tests/schedule-media.local.test.cjs', 'tests/onboarding.local.test.cjs'], {
    cwd: root, env: localEnvironment(status(), process.env), stdio: 'inherit', timeout: 120000,
  })
  if (result.status !== 0) throw new Error('Local recovery integration tests failed.')
}

try {
  switch (process.argv[2]) {
    case 'prepare': prepare(); break
    case 'start':
      prepare()
      console.log('Starting local containers; the first download can take several minutes...')
      cli(['start'])
      cli(['migration', 'up']) // CLI v3 targets local by default; no remote option is exposed.
      console.log('Supabase local ready. Studio: http://127.0.0.1:54323 | Mailpit: http://127.0.0.1:54324')
      break
    case 'migrate': prepare(); status(); cli(['migration', 'up']); console.log('Local migrations applied.'); break
    case 'stop': cli(['stop']); console.log('Local containers stopped; data preserved.'); break
    case 'status': status(); console.log('Local Supabase running at http://127.0.0.1:54321. No keys printed.'); break
    case 'seed': await seed(); break
    case 'dev': dev(); break
    case 'test': testRecovery(); break
    default: throw new Error('Use pnpm local:prepare, local:start, local:migrate, local:stop, local:status, local:seed, local:dev or local:test.')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
