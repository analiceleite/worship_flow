import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'

const url = new URL(process.env.LOCAL_DATABASE_URL || '')
if (process.env.LOCAL_DOCKER !== 'true' || url.hostname !== 'db' || url.port !== '5432' || url.pathname !== '/postgres') {
  throw new Error('Refusing migrations outside the local Compose database')
}
const client = new pg.Client({ connectionString: url.toString() })
await client.connect()
try {
  await client.query('SELECT pg_advisory_lock(904033)')
  await client.query('CREATE SCHEMA IF NOT EXISTS worship_local')
  await client.query('CREATE TABLE IF NOT EXISTS worship_local.migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
  for (const name of fs.readdirSync('/local/migrations').filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort()) {
    const sql = fs.readFileSync(`/local/migrations/${name}`, 'utf8')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM worship_local.migrations WHERE name = $1', [name])
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Already applied migration changed: ${name}. No data was reset.`)
      continue
    }
    await client.query('BEGIN')
    try {
      // One transaction includes both the migration and its history entry.
      await client.query(sql.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, ''))
      await client.query('INSERT INTO worship_local.migrations (name, checksum) VALUES ($1, $2)', [name, checksum])
      await client.query('COMMIT')
      console.log(`Applied local migration: ${name}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  await client.query("NOTIFY pgrst, 'reload schema'")
} finally {
  await client.end()
}
