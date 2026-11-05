import fs from 'node:fs'
import path from 'node:path'
import { buildLocalBaseline } from '../../scripts/local-supabase-utils.mjs'

if (process.env.LOCAL_DOCKER !== 'true') throw new Error('Local Compose environment required')
const directory = '/local/migrations'
fs.mkdirSync(directory, { recursive: true })
const baseline = buildLocalBaseline(fs.readFileSync('scripts/001_create_tables.sql', 'utf8'))
fs.writeFileSync(path.join(directory, '001_local_baseline.sql'), baseline)
for (const name of fs.readdirSync('scripts').sort()) {
  if (/^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 16) {
    fs.copyFileSync(path.join('scripts', name), path.join(directory, name))
  }
}
const template = fs.readFileSync('docker/local/kong.yml', 'utf8')
const kong = template.replace('__ANON_KEY__', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  .replace('__SERVICE_KEY__', process.env.SUPABASE_SERVICE_ROLE_KEY)
fs.writeFileSync('/local/kong.yml', kong)
console.log('Local Compose configuration and migrations prepared. No production files loaded.')
