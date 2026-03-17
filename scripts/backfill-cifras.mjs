import * as cheerio from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env.local
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const envPath = resolve(__dirname, '../.env.local')

try {
  const envContent = readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  })
} catch (err) {
  console.error(`Warning: Could not load .env.local from ${envPath}: ${err.message}`)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  console.error(`NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL ? 'set' : 'NOT SET'}`)
  console.error(`SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET'}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ONLY_MISSING = !process.argv.includes('--force')
const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeUrl = (raw) => {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const extractCifraLines = async (url) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const pre = $('.cifra_cnt pre').first()
  const raw = pre.length ? pre.text() : $('pre').first().text()
  const lines = raw.split('\n')

  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length === 0) throw new Error('Cifra vazia ou não encontrada')

  return lines
}

const run = async () => {
  let query = supabase
    .from('songs')
    .select('id,title,artist,cipher_url,cifra_content')
    .order('created_at', { ascending: true })

  if (ONLY_MISSING) {
    query = query.is('cifra_content', null)
  }

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
    query = query.limit(LIMIT)
  }

  const { data: songs, error } = await query
  if (error) throw error

  if (!songs || songs.length === 0) {
    console.log('No songs to process.')
    return
  }

  console.log(`Found ${songs.length} song(s) to process.`)
  console.log(`Mode: ${ONLY_MISSING ? 'only missing cifra_content' : 'force all'}${DRY_RUN ? ' (dry-run)' : ''}`)

  let ok = 0
  let skipped = 0
  let failed = 0
  const skippedSongs = []
  const failedSongs = []

  for (const song of songs) {
    const url = normalizeUrl(song.cipher_url)
    if (!url) {
      skipped += 1
      skippedSongs.push({ id: song.id, title: song.title, reason: 'sem cipher_url' })
      console.log(`SKIP [${song.id}] ${song.title} - sem cipher_url`)
      continue
    }

    try {
      const lines = await extractCifraLines(url)

      // Check for duplicates: only update if cifra_content doesn't already exist
      const { data: existing } = await supabase
        .from('songs')
        .select('cifra_content')
        .eq('id', song.id)
        .single()

      if (existing?.cifra_content && existing.cifra_content.length > 0) {
        skipped += 1
        skippedSongs.push({ id: song.id, title: song.title, reason: 'cifra_content já existe' })
        console.log(`DUP  [${song.id}] ${song.title} - cifra_content já existe`)
        continue
      }

      if (DRY_RUN) {
        ok += 1
        console.log(`DRY  [${song.id}] ${song.title} - ${lines.length} linhas`) 
      } else {
        const { error: updateError } = await supabase
          .from('songs')
          .update({ cifra_content: lines })
          .eq('id', song.id)

        if (updateError) throw updateError

        ok += 1
        console.log(`OK   [${song.id}] ${song.title} - ${lines.length} linhas`) 
      }
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      failedSongs.push({ id: song.id, title: song.title, error: message })
      console.log(`FAIL [${song.id}] ${song.title} - ${message}`)
    }

    // Gentle pacing to avoid hammering CifraClub.
    await sleep(450)
  }

  console.log('\n' + '='.repeat(80))
  console.log('Backfill summary:')
  console.log('='.repeat(80))
  console.log(`OK: ${ok}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)

  if (skippedSongs.length > 0) {
    console.log('\n📋 Músicas puladas:')
    skippedSongs.forEach((song) => {
      console.log(`   [${song.id}] ${song.title} - ${song.reason}`)
    })
  }

  if (failedSongs.length > 0) {
    console.log('\n❌ Músicas com erro:')
    failedSongs.forEach((song) => {
      console.log(`   [${song.id}] ${song.title}`)
      console.log(`      Erro: ${song.error}`)
    })
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
