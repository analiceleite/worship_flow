import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { assertLocalUrl, buildLocalBaseline, localEnvironment } from '../scripts/local-supabase-utils.mjs'

test('local bootstrap resolves the reference snapshot FK order without changing definitions', () => {
  const source = fs.readFileSync(new URL('../scripts/001_create_tables.sql', import.meta.url), 'utf8')
  const baseline = buildLocalBaseline(source)
  assert.ok(baseline.indexOf('CREATE TABLE public.songs') < baseline.indexOf('CREATE TABLE public.repertoire'))
  assert.ok(baseline.indexOf('CREATE TABLE public.schedule_roles') < baseline.indexOf('CREATE TABLE public.schedule_assignments'))
  assert.ok(baseline.indexOf('CREATE TABLE public.schedule_quarters') < baseline.indexOf('CREATE TABLE public.schedule_assignments'))
  for (const match of source.matchAll(/CREATE TABLE public\.\w+ \([\s\S]*?\n\);/g)) assert.ok(baseline.includes(match[0]))
  assert.throws(() => buildLocalBaseline(source.replace('CREATE TABLE public.songs', 'CREATE TABLE public.renamed_songs')))
})

test('local tools reject hosted, non-loopback and unexpected-port destinations', () => {
  assert.equal(assertLocalUrl('http://127.0.0.1:54321', 54321), 'http://127.0.0.1:54321')
  for (const url of ['https://project.supabase.co', 'http://192.168.1.1:54321', 'http://127.0.0.1:54322',
    'http://user:password@127.0.0.1:54321', 'http://127.0.0.1:54321/?target=production']) {
    assert.throws(() => assertLocalUrl(url, 54321))
  }
})

test('local runtime overrides production destinations and disables credentialed external integrations', () => {
  const inherited = { NEXT_PUBLIC_SUPABASE_URL: 'https://production.example.com', SUPABASE_SERVICE_ROLE_KEY: 'production-key',
    RESEND_API_KEY: 'production-mail-key', GOOGLE_CLIENT_SECRET: 'production-google-secret', YOUTUBE_API_KEY: 'production-video-key' }
  const env = localEnvironment({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' }, inherited)
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321')
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, 'local-service')
  for (const key of ['RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET', 'YOUTUBE_API_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) assert.equal(env[key], '')
  assert.equal(env.APP_BASE_URL, 'http://127.0.0.1:3001')
  assert.equal(env.LOCAL_SUPABASE, 'true')
  assert.equal(inherited.SUPABASE_SERVICE_ROLE_KEY, 'production-key')
  assert.throws(() => localEnvironment({ API_URL: 'https://production.example.com', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'secret' }))
  assert.throws(() => localEnvironment({ API_URL: 'http://127.0.0.1:54321' }))
})
