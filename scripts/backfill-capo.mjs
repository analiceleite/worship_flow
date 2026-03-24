#!/usr/bin/env node
import * as cheerio from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env.local (same pattern as other scripts)
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
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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

const parseCifraUrl = (url) => {
  try {
    const u = new URL(url)
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length >= 2) {
      const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
      return { artist: parts[0], song: parts[1], version }
    }
  } catch {
    return null
  }
  return null
}

// Extract capo from the page HTML
const extractCapo = (html) => {
  const m = html.match(/capotra?ste[^0-9]{0,40}?(\d{1,2})\s*(?:\u00AA|a)?\s*casa/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isInteger(n) && n >= 0 && n <= 12) return n
  }
  return 0
}

// Fetch capo using our own /api/cifraclub endpoint (resolves tone + capo consistently)
const fetchCapoViaApi = async ({ artist, song, version, tone }) => {
  const params = new URLSearchParams({ artist, song })
  if (version) params.set('version', version)
  if (tone) params.set('target_tone', tone)

  const url = `http://localhost:3000/api/cifraclub?${params.toString()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json()
  return typeof data.capo_frets === 'number' ? data.capo_frets : 0
}

// Fallback: scrape the original cipher_url directly
const fetchCapoViaScrape = async (cipherUrl) => {
  const res = await fetch(cipherUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return extractCapo(html)
}

const run = async () => {
  let query = supabase
    .from('songs')
    .select('id,title,artist,tone,cipher_url,capo_frets')
    .order('created_at', { ascending: true })
    .or('capo_frets.is.null,capo_frets.eq.0')

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
    query = query.limit(LIMIT)
  }

  const { data: songs, error } = await query
  if (error) throw error
  if (!songs || songs.length === 0) {
    console.log('No songs pending capo backfill.')
    return
  }

  console.log(`Found ${songs.length} song(s) missing capo. ${DRY_RUN ? '(dry-run)' : ''}`)

  let ok = 0
  let skipped = 0
  let failed = 0

  for (const song of songs) {
    const url = normalizeUrl(song.cipher_url)
    if (!url) {
      skipped += 1
      console.log(`SKIP [${song.id}] ${song.title} - sem cipher_url`)
      continue
    }

    let capo = 0
    try {
      const parsed = parseCifraUrl(url)
      if (parsed) {
        capo = await fetchCapoViaApi({ ...parsed, tone: song.tone })
      } else {
        capo = await fetchCapoViaScrape(url)
      }
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`FAIL [${song.id}] ${song.title} - ${msg}`)
      await sleep(400)
      continue
    }

    if (capo <= 0) {
      skipped += 1
      console.log(`SKIP [${song.id}] ${song.title} - capo 0/indefinido`)
      await sleep(400)
      continue
    }

    if (DRY_RUN) {
      ok += 1
      console.log(`DRY  [${song.id}] ${song.title} - capo ${capo}`)
    } else {
      const { error: updateError } = await supabase
        .from('songs')
        .update({ capo_frets: capo })
        .eq('id', song.id)

      if (updateError) {
        failed += 1
        console.log(`FAIL [${song.id}] ${song.title} - ${updateError.message}`)
      } else {
        ok += 1
        console.log(`OK   [${song.id}] ${song.title} - capo ${capo}`)
      }
    }

    await sleep(400) // be gentle with CifraClub and our API
  }

  console.log('\nSummary:')
  console.log(`OK: ${ok}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Failed: ${failed}`)
}

run().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
