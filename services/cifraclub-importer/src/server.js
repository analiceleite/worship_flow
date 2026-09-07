import http from 'node:http'
import { chromium } from 'playwright'

const config = {
  port: Number(process.env.PORT || 3010),
  token: process.env.CIFRACLUB_IMPORTER_TOKEN || '',
  importTimeoutMs: Number(process.env.IMPORT_TIMEOUT_MS || 30000),
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 14),
  failureCacheTtlMs: Number(process.env.FAILURE_CACHE_TTL_MS || 1000 * 60 * 5),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 1000 * 60 * 10),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 30),
}

const CIFRACLUB_BASE = 'https://www.cifraclub.com.br'
const ALLOWED_HOSTS = new Set(['cifraclub.com.br', 'www.cifraclub.com.br'])
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const MAJOR_TONES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MINOR_TONES = MAJOR_TONES.map((tone) => `${tone}m`)

const TONE_ALIASES = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Dbm: 'C#m',
  Ebm: 'D#m',
  Gbm: 'F#m',
  Abm: 'G#m',
  Bbm: 'A#m',
}

const NOTE_INDEX = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

const SELECTORS = {
  pageRoot: 'main#chordPage',
  title: 'main#chordPage h1, h1.t1, h1',
  artist: 'main#chordPage h1 + a h2, h2.t3 a, h2.t3, .cifra h2 a, .cifra h2',
  cifra: 'pre[data-chord-content="true"], .cifra_cnt pre, pre',
  currentTone: '[data-chord-config="true"] button[data-anchor="--chord-tone"], #cifra_tom a, #cifra_tom',
  toneUp: '#key [aria-label="Aumentar tom"], [aria-label="Aumentar tom"]',
  toneDown: '#key [aria-label="Diminuir tom"], [aria-label="Diminuir tom"]',
}

const cache = new Map()
const rateLimit = new Map()

class ImporterError extends Error {
  constructor(message, code, status = 500, availableTones) {
    super(message)
    this.name = 'ImporterError'
    this.code = code
    this.status = status
    this.available_tones = availableTones
  }
}

function logEvent(event, fields = {}) {
  console.log(
    JSON.stringify({
      event,
      service: 'cifraclub-importer',
      timestamp: new Date().toISOString(),
      ...fields,
    })
  )
}

function normalizeTone(raw) {
  const cleaned = String(raw || '').trim().replace(/\s+/g, '')
  const match = cleaned.match(/^([A-G][#b]?m?)/i)
  if (!match) return null
  const tone = `${match[1][0].toUpperCase()}${match[1].slice(1)}`
  if (!/^[A-G][#b]?m?$/.test(tone)) return null
  return TONE_ALIASES[tone] || tone
}

function tonePitchClass(tone) {
  const normalized = normalizeTone(tone)
  if (!normalized) return null
  const minor = normalized.endsWith('m') && normalized.length > 1
  const root = minor ? normalized.slice(0, -1) : normalized
  const pc = NOTE_INDEX[root]
  if (pc === undefined) return null
  return { pc, minor }
}

function tonesAreEquivalent(a, b) {
  const pa = tonePitchClass(a)
  const pb = tonePitchClass(b)
  return Boolean(pa && pb && pa.pc === pb.pc && pa.minor === pb.minor)
}

function availableTonesForMode(tone) {
  return normalizeTone(tone)?.endsWith('m') ? MINOR_TONES : MAJOR_TONES
}

function semitoneDistance(fromTone, toTone) {
  const from = tonePitchClass(fromTone)
  const to = tonePitchClass(toTone)
  if (!from || !to || from.minor !== to.minor) return null
  return (to.pc - from.pc + 12) % 12
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10000) {
        req.destroy()
        reject(new ImporterError('Payload muito grande.', 'PAYLOAD_TOO_LARGE', 413))
      }
    })

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new ImporterError('JSON invalido.', 'INVALID_JSON', 400))
      }
    })

    req.on('error', reject)
  })
}

function assertAuthorized(req) {
  if (!config.token) return
  if (req.headers.authorization !== `Bearer ${config.token}`) {
    throw new ImporterError('Unauthorized', 'UNAUTHORIZED', 401)
  }
}

function assertRateLimit(req) {
  const key = req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const current = rateLimit.get(key)

  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs })
    return
  }

  current.count += 1
  if (current.count > config.rateLimitMax) {
    throw new ImporterError('Rate limit excedido.', 'RATE_LIMITED', 429)
  }
}

function toTitleCaseFromSlug(value) {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function parseAllowedUrl(input) {
  const url = new URL(String(input).includes('://') ? input : `https://${input}`)
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ImporterError('Host nao permitido.', 'INVALID_HOST', 400)
  }
  return url
}

function buildCifraClubUrl(payload) {
  if (payload.url) return parseAllowedUrl(payload.url).toString()

  const artist = String(payload.artist || '').trim().replace(/^\/+|\/+$/g, '')
  const song = String(payload.song || '').trim().replace(/^\/+|\/+$/g, '')

  if (!/^[a-z0-9-]+$/i.test(artist) || !/^[a-z0-9-]+$/i.test(song)) {
    throw new ImporterError('Informe uma URL do CifraClub ou artista/musica validos.', 'INVALID_PAYLOAD', 400)
  }

  return `${CIFRACLUB_BASE}/${artist}/${song}/`
}

function inferNamesFromUrl(url) {
  const parsed = parseAllowedUrl(url)
  const [artistSlug, songSlug] = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  return {
    artist: toTitleCaseFromSlug(artistSlug),
    name: toTitleCaseFromSlug(songSlug),
  }
}

function cacheKeyForPayload(payload) {
  return JSON.stringify({
    url: payload.url || null,
    artist: payload.artist || null,
    song: payload.song || null,
    target_tone: normalizeTone(payload.target_tone) || payload.target_tone || null,
  })
}

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry
}

function setCached(key, value, ttl) {
  cache.set(key, { ...value, expiresAt: Date.now() + ttl })
}

function shouldCacheFailure(errorBody) {
  return errorBody.status >= 500 && !['TIMEOUT', 'TRANSPOSE_FAILED'].includes(errorBody.code)
}

function isBlockedContent(text) {
  const lower = text.toLowerCase()
  return lower.includes('captcha') || lower.includes('access denied') || lower.includes('cf-challenge')
}

async function textFromFirstLocator(page, selector) {
  const locator = page.locator(selector).first()
  if ((await locator.count()) === 0) return ''
  return locator.innerText({ timeout: 3000 }).then((text) => text.trim()).catch(() => '')
}

async function waitForCifra(page) {
  await page.waitForSelector(SELECTORS.cifra, { timeout: config.importTimeoutMs })
}

async function assertAllowedFinalPage(page) {
  const finalUrl = parseAllowedUrl(page.url())
  const html = await page.content()
  if (isBlockedContent(html)) {
    throw new ImporterError('CifraClub bloqueou a automacao.', 'BLOCKED', 502)
  }
  return finalUrl
}

async function currentToneFromPage(page) {
  const rawTone = await textFromFirstLocator(page, SELECTORS.currentTone)
  return normalizeTone(rawTone)
}

async function clickTransposeControl(page, selector, step) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const clicked = await page.evaluate((buttonSelector) => {
      const button = document.querySelector(buttonSelector)
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false
      button.click()
      return true
    }, selector)

    if (clicked) {
      logEvent('transpose_click', { step, attempt })
      return
    }

    await page.waitForTimeout(150 * attempt)
  }

  throw new ImporterError('Controle de transposicao nao encontrado no CifraClub.', 'NO_TRANSPOSE_CONTROL', 404)
}

async function waitForToneChange(page, previousTone) {
  await page
    .waitForFunction(
      ({ selector, previous }) => {
        const raw = document.querySelector(selector)?.textContent?.trim() || ''
        return raw.length > 0 && raw !== previous
      },
      { selector: SELECTORS.currentTone, previous: previousTone },
      { timeout: 3000 }
    )
    .catch(() => undefined)
}

async function transposeToTone(page, targetTone) {
  const requestedTone = normalizeTone(targetTone)
  if (!requestedTone) return null

  let currentTone = await currentToneFromPage(page)
  if (!currentTone) {
    throw new ImporterError('Nao foi possivel identificar o tom atual no CifraClub.', 'NO_TONE', 404)
  }

  if (tonesAreEquivalent(currentTone, requestedTone)) return requestedTone

  const distanceUp = semitoneDistance(currentTone, requestedTone)
  if (distanceUp === null) {
    throw new ImporterError(
      `Tom "${targetTone}" indisponivel para esta cifra.`,
      'INVALID_TONE',
      422,
      availableTonesForMode(currentTone)
    )
  }

  const direction = distanceUp <= 6 ? 'up' : 'down'
  const steps = direction === 'up' ? distanceUp : 12 - distanceUp
  const selector = direction === 'up' ? SELECTORS.toneUp : SELECTORS.toneDown

  logEvent('transpose_start', { from_tone: currentTone, to_tone: requestedTone, direction, steps })

  for (let i = 0; i < steps; i += 1) {
    const previousTone = await textFromFirstLocator(page, SELECTORS.currentTone)
    await clickTransposeControl(page, selector, i + 1)
    await waitForToneChange(page, previousTone)
    await page.waitForTimeout(150)
  }

  currentTone = await currentToneFromPage(page)
  if (!currentTone || !tonesAreEquivalent(currentTone, requestedTone)) {
    throw new ImporterError('Nao foi possivel transpor a cifra para o tom solicitado.', 'TRANSPOSE_FAILED', 502)
  }

  logEvent('transpose_ok', { tone: currentTone })
  return currentTone
}

async function extractPageMetadata(page) {
  return page.evaluate(() => {
    const firstText = (selectors) => {
      for (const selector of selectors) {
        const text = document.querySelector(selector)?.textContent?.trim()
        if (text) return text
      }
      return ''
    }

    const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || ''
    const pageTitle = document.title || ''
    const titleSource =
      meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || pageTitle
    const titleParts = titleSource
      .replace(/\s*-\s*Cifra Club.*$/i, '')
      .split(/\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean)

    const cifraRoot = document.querySelector('.cifra') || document
    const cifraPre = document.querySelector('pre[data-chord-content="true"]') || document.querySelector('.cifra_cnt pre') || document.querySelector('pre')
    const playerImg =
      cifraRoot.querySelector('.player-placeholder img')?.getAttribute('src') ||
      meta('meta[property="og:image"]')
    const youtubeMatch = playerImg.match(/\/vi\/([A-Za-z0-9_-]{11})\//)

    return {
      artist:
        firstText(['main#chordPage h1 + a h2', 'h2.t3 a', 'h2.t3', '.cifra h2 a', '.cifra h2']) ||
        titleParts[1] ||
        '',
      name: firstText(['main#chordPage h1', 'h1.t1', 'h1', '.cifra h1']) || titleParts[0] || '',
      cifra: (cifraPre?.innerText || cifraPre?.textContent || '').split('\n'),
      youtube_url: youtubeMatch ? `https://www.youtube.com/watch?v=${youtubeMatch[1]}` : '',
      capo_text: document.body.textContent || '',
    }
  })
}

function capoFretsFromText(text) {
  const match = String(text || '').match(/capotra?ste[^0-9]{0,40}?(\d{1,2})\s*[ªa]?\s*casa/i)
  const capo = match ? Number(match[1]) : 0
  return Number.isInteger(capo) && capo >= 0 && capo <= 12 ? capo : 0
}

async function extractFromPage(page, sourceUrl, targetTone) {
  logEvent('navigation_start', { url: sourceUrl })
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: config.importTimeoutMs })
  await assertAllowedFinalPage(page)
  await waitForCifra(page)
  logEvent('navigation_ok', { url: page.url() })

  const initialTone = await currentToneFromPage(page)
  const importedTone = targetTone ? await transposeToTone(page, targetTone) : initialTone
  await waitForCifra(page)

  const metadata = await extractPageMetadata(page)
  const nonEmptyLines = metadata.cifra.filter((line) => line.trim().length > 0)
  if (nonEmptyLines.length === 0) {
    throw new ImporterError('Nao foi possivel extrair a cifra.', 'NO_CIFRA', 404)
  }

  const finalTone = importedTone || (await currentToneFromPage(page)) || 'C'
  const inferred = inferNamesFromUrl(page.url())

  return {
    artist: metadata.artist || inferred.artist,
    name: metadata.name || inferred.name,
    tone: finalTone,
    available_tones: availableTonesForMode(finalTone),
    youtube_url: metadata.youtube_url,
    cipher_url: page.url().split('?')[0],
    cifra: metadata.cifra,
    capo_frets: capoFretsFromText(metadata.capo_text),
    source: 'cifraclub',
  }
}

async function importCifra(payload) {
  const sourceUrl = buildCifraClubUrl(payload)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'pt-BR', userAgent: USER_AGENT })

  try {
    const page = await context.newPage()
    return await extractFromPage(page, sourceUrl, payload.target_tone)
  } finally {
    await browser.close()
  }
}

function errorResponse(err) {
  const status = err.status || (err.name === 'TimeoutError' ? 504 : 500)
  const code = err.code || (err.name === 'TimeoutError' ? 'TIMEOUT' : 'FETCH_FAILED')

  return {
    status,
    body: {
      error: err.message || 'Erro ao importar cifra.',
      code,
      status,
      available_tones: err.available_tones,
    },
  }
}

async function handleImport(req, res) {
  const startedAt = Date.now()
  let requestCacheKey = null

  try {
    assertAuthorized(req)
    assertRateLimit(req)

    const payload = await readJson(req)
    requestCacheKey = cacheKeyForPayload(payload)

    const cached = getCached(requestCacheKey)
    if (cached?.ok) {
      logEvent('cache_hit', { duration_ms: Date.now() - startedAt })
      return json(res, 200, { ...cached.result, cache: 'hit', duration_ms: Date.now() - startedAt })
    }

    if (cached && !cached.ok) {
      logEvent('failure_cache_hit', { code: cached.error.code, duration_ms: Date.now() - startedAt })
      return json(res, cached.error.status, { ...cached.error, cache: 'hit' })
    }

    logEvent('import_start', { has_url: Boolean(payload.url), target_tone: payload.target_tone || null })
    const result = await importCifra(payload)
    setCached(requestCacheKey, { ok: true, result }, config.cacheTtlMs)

    logEvent('import_ok', {
      artist: result.artist,
      name: result.name,
      tone: result.tone,
      lines: result.cifra.length,
      duration_ms: Date.now() - startedAt,
    })

    return json(res, 200, { ...result, cache: 'miss', duration_ms: Date.now() - startedAt })
  } catch (err) {
    const { status, body } = errorResponse(err)
    if (requestCacheKey && shouldCacheFailure(body)) {
      setCached(requestCacheKey, { ok: false, error: body }, config.failureCacheTtlMs)
    }

    logEvent('import_error', { code: body.code, status, duration_ms: Date.now() - startedAt })
    return json(res, status, body)
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && req.url === '/import') {
    return handleImport(req, res)
  }

  return json(res, 404, { error: 'Not found', code: 'NOT_FOUND' })
})

server.listen(config.port, () => {
  logEvent('server_start', { port: config.port })
})
