import * as cheerio from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const FIX_TONE = args.includes('--fix-tone')
const REWRITE_CIFRA = args.includes('--rewrite-cifra')
const DRY_RUN = !(FIX_TONE || REWRITE_CIFRA)
const LIMIT_ARG = args.find((arg) => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null
const MIN_SCORE_ARG = args.find((arg) => arg.startsWith('--min-score='))
const MIN_SCORE = MIN_SCORE_ARG ? Number(MIN_SCORE_ARG.split('=')[1]) : 0.88

if (args.includes('--help')) {
  console.log('Usage: node scripts/audit-song-tones.mjs [--limit=N] [--min-score=0.88] [--fix-tone] [--rewrite-cifra]')
  console.log('')
  console.log('Detects songs where saved tone does not match saved cifra_content.')
  console.log('')
  console.log('Options:')
  console.log('  --limit=N         Process only first N songs.')
  console.log('  --min-score=VAL   Minimum confidence score (0..1). Default: 0.88')
  console.log('  --fix-tone        Update songs.tone to inferred tone when confidence is high.')
  console.log('  --rewrite-cifra   Rewrite songs.cifra_content to match the currently saved songs.tone.')
  process.exit(0)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const loadEnvFile = (fileName) => {
  const envPath = resolve(__dirname, `../${fileName}`)
  if (!existsSync(envPath)) return

  const envContent = readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    if (!match) return

    const key = match[1].trim()
    const value = match[2].trim().replace(/^"|"$/g, '')
    if (!process.env[key]) process.env[key] = value
  })
}

loadEnvFile('.env.local')
loadEnvFile('.env.development.local')
loadEnvFile('.env.production.local')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const NOTE_INDEX = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11,
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const TONE_ALIASES = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Bb: 'A#',
  Dbm: 'C#m',
  Ebm: 'D#m',
  Gbm: 'F#m',
  Bbm: 'A#m',
}

const normalizeTone = (raw) => {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '')
  if (!/^[A-G][#b]?m?$/i.test(cleaned)) return null
  const upper = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
  return TONE_ALIASES[upper] ?? upper
}

const parseToneRoot = (tone) => {
  const m = String(tone || '').trim().match(/^([A-G](?:#|b)?)/)
  return m ? m[1] : null
}

const transposeRoot = (root, semitones) => {
  const idx = NOTE_INDEX[root]
  if (idx == null) return root
  const next = (idx + semitones + 120) % 12
  const prefersFlat = root.includes('b')
  return prefersFlat ? NOTES_FLAT[next] : NOTES_SHARP[next]
}

const transposeChordSymbol = (symbol, semitones) => {
  const [main, bass] = symbol.split('/')

  const transposePart = (part) => {
    const m = part.match(/^([A-G](?:#|b)?)(.*)$/)
    if (!m) return part
    return `${transposeRoot(m[1], semitones)}${m[2]}`
  }

  const nextMain = transposePart(main)
  if (!bass) return nextMain
  return `${nextMain}/${transposePart(bass)}`
}

const transposeCifra = (lines, fromTone, toTone) => {
  const fromRoot = parseToneRoot(fromTone)
  const toRoot = parseToneRoot(toTone)
  if (!fromRoot || !toRoot) return lines
  if (fromRoot === toRoot) return lines

  const fromIdx = NOTE_INDEX[fromRoot]
  const toIdx = NOTE_INDEX[toRoot]
  if (fromIdx == null || toIdx == null) return lines

  const semitones = toIdx - fromIdx
  const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

  return lines.map((line) => line.replace(chordRe, (token) => transposeChordSymbol(token, semitones)))
}

const normalizeLineForCompare = (line) => String(line || '').replace(/\s+/g, ' ').trim()

const similarityScore = (aLines, bLines) => {
  const a = aLines.map(normalizeLineForCompare)
  const b = bLines.map(normalizeLineForCompare)
  const maxLen = Math.max(a.length, b.length, 1)
  const minLen = Math.min(a.length, b.length)

  let equal = 0
  for (let i = 0; i < minLen; i += 1) {
    if (a[i] === b[i]) equal += 1
  }

  return equal / maxLen
}

const parseCifraClubUrl = (input) => {
  try {
    const url = new URL(String(input || '').trim())
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) return null
    const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
    return { artist: parts[0], song: parts[1], version }
  } catch {
    return null
  }
}

const fetchCifraClubData = async (cipherUrl) => {
  const parsed = parseCifraClubUrl(cipherUrl)
  if (!parsed) throw new Error('invalid-cifraclub-url')

  const pageUrl = parsed.version
    ? `https://www.cifraclub.com.br/${parsed.artist}/${parsed.song}/${parsed.version}`
    : `https://www.cifraclub.com.br/${parsed.artist}/${parsed.song}/`

  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Accept: 'text/html',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) throw new Error(`cifraclub-http-${response.status}`)

  const html = await response.text()
  const $ = cheerio.load(html)

  let tone = ''
  const toneFromAnchor = normalizeTone($('#cifra_tom a').first().text())
  if (toneFromAnchor) {
    tone = toneFromAnchor
  } else {
    const cifraTomel = $('#cifra_tom').text()
    const tomMatch = cifraTomel.match(/([A-G][#b]?m?)\s*(?:\(|$)/i)
    if (tomMatch) tone = normalizeTone(tomMatch[1]) || ''
  }

  const available = []
  const seen = new Set()
  const items = $('#side-tom ul li')
  if (items.length > 1) {
    items.slice(1).each((_, el) => {
      const raw = $(el).contents().filter((_, n) => n.type === 'text').text().trim()
      const t = normalizeTone(raw)
      if (t && !seen.has(t)) {
        seen.add(t)
        available.push(t)
      }
    })
  }

  const lines = []
  const preEl = $('.cifra_cnt pre').first()
  const preText = preEl.length ? preEl.text() : $('pre').first().text()
  preText.split('\n').forEach((line) => lines.push(line))

  return {
    officialTone: tone,
    availableTones: available,
    officialCifra: lines,
    pageUrl,
  }
}

const inferToneFromSavedCifra = (officialTone, availableTones, officialCifra, savedCifra) => {
  if (!officialTone || !availableTones.length) return { bestTone: null, score: 0 }

  let bestTone = null
  let bestScore = -1

  for (const candidateTone of availableTones) {
    const candidateLines = candidateTone === officialTone
      ? officialCifra
      : transposeCifra(officialCifra, officialTone, candidateTone)

    const score = similarityScore(candidateLines, savedCifra)
    if (score > bestScore) {
      bestScore = score
      bestTone = candidateTone
    }
  }

  return {
    bestTone,
    score: bestScore,
  }
}

const buildCifraForTone = (officialTone, officialCifra, targetTone) => {
  if (!officialTone || !targetTone) return officialCifra
  if (officialTone === targetTone) return officialCifra
  return transposeCifra(officialCifra, officialTone, targetTone)
}

const run = async () => {
  console.log('Song tone audit started')
  const modeLabel = DRY_RUN
    ? 'detect only'
    : `${FIX_TONE ? 'fix tone' : ''}${FIX_TONE && REWRITE_CIFRA ? ' + ' : ''}${REWRITE_CIFRA ? 'rewrite cifra' : ''}`
  console.log(`Mode: ${modeLabel}`)
  console.log(`Min confidence score: ${MIN_SCORE}`)

  let query = supabase
    .from('songs')
    .select('id,title,artist,tone,cipher_url,cifra_content,created_at')
    .order('created_at', { ascending: true })

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
    query = query.limit(LIMIT)
  }

  const { data: songs, error } = await query
  if (error) throw error
  if (!songs?.length) {
    console.log('No songs found.')
    return
  }

  let processed = 0
  let skipped = 0
  let ok = 0
  let mismatch = 0
  let lowConfidence = 0
  let fixed = 0
  let rewritten = 0

  const mismatchRows = []

  for (const song of songs) {
    const hasCifra = Array.isArray(song.cifra_content) && song.cifra_content.length > 0
    const hasUrl = Boolean(song.cipher_url)

    if (!hasCifra || !hasUrl) {
      skipped += 1
      continue
    }

    processed += 1

    try {
      const remote = await fetchCifraClubData(song.cipher_url)
      if (!remote.officialTone || remote.availableTones.length === 0 || remote.officialCifra.length === 0) {
        skipped += 1
        continue
      }

      const inferred = inferToneFromSavedCifra(
        remote.officialTone,
        remote.availableTones,
        remote.officialCifra,
        song.cifra_content
      )

      if (!inferred.bestTone || inferred.score < MIN_SCORE) {
        lowConfidence += 1
        console.log(`LOW  [${song.id}] ${song.title} | saved=${song.tone} inferred=${inferred.bestTone ?? '-'} score=${inferred.score.toFixed(3)}`)
        await sleep(400)
        continue
      }

      if (inferred.bestTone !== song.tone) {
        mismatch += 1
        mismatchRows.push({
          id: song.id,
          title: song.title,
          artist: song.artist,
          savedTone: song.tone,
          inferredTone: inferred.bestTone,
          score: inferred.score,
          officialTone: remote.officialTone,
          pageUrl: remote.pageUrl,
        })

        console.log(`DIFF [${song.id}] ${song.title} | saved=${song.tone} inferred=${inferred.bestTone} official=${remote.officialTone} score=${inferred.score.toFixed(3)}`)

        if (FIX_TONE) {
          const { error: updateError } = await supabase
            .from('songs')
            .update({ tone: inferred.bestTone })
            .eq('id', song.id)

          if (updateError) {
            console.log(`ERR  [${song.id}] update failed: ${updateError.message}`)
          } else {
            fixed += 1
            console.log(`FIX  [${song.id}] tone updated to ${inferred.bestTone}`)
          }
        }

        if (REWRITE_CIFRA) {
          if (!remote.availableTones.includes(song.tone)) {
            console.log(`SKIP [${song.id}] rewrite skipped: saved tone ${song.tone} is not in CifraClub tone list`)
          } else {
            const rewrittenLines = buildCifraForTone(remote.officialTone, remote.officialCifra, song.tone)
            const { error: rewriteError } = await supabase
              .from('songs')
              .update({ cifra_content: rewrittenLines })
              .eq('id', song.id)

            if (rewriteError) {
              console.log(`ERR  [${song.id}] rewrite failed: ${rewriteError.message}`)
            } else {
              rewritten += 1
              console.log(`REWR [${song.id}] cifra_content rewritten to match saved tone ${song.tone}`)
            }
          }
        }
      } else {
        ok += 1
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`FAIL [${song.id}] ${song.title} | ${message}`)
    }

    await sleep(400)
  }

  console.log('')
  console.log('='.repeat(90))
  console.log('Song tone audit summary')
  console.log('='.repeat(90))
  console.log(`Total songs:      ${songs.length}`)
  console.log(`Processed:        ${processed}`)
  console.log(`Skipped:          ${skipped}`)
  console.log(`OK:               ${ok}`)
  console.log(`Mismatch:         ${mismatch}`)
  console.log(`Low confidence:   ${lowConfidence}`)
  console.log(`Fixed:            ${fixed}`)
  console.log(`Rewritten:        ${rewritten}`)

  if (mismatchRows.length > 0) {
    console.log('')
    console.log('Mismatches detected:')
    mismatchRows.forEach((row) => {
      console.log(`- [${row.id}] ${row.title} - ${row.artist}`)
      console.log(`  saved=${row.savedTone} inferred=${row.inferredTone} official=${row.officialTone} score=${row.score.toFixed(3)}`)
      console.log(`  ${row.pageUrl}`)
    })
  }
}

run().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})
