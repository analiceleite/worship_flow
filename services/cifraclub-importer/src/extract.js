import * as cheerio from 'cheerio'
import { OriginalCifraSchema } from './contract.js'
import { assertAllowedDestination, hosts } from './network-policy.js'

export function parseCifraHtml(html, url) {
  if (/captcha|verify you are human|access denied|just a moment/i.test(html)) throw Error('BLOCKED')
  const $ = cheerio.load(html)
  const source = hosts.has(new URL(url).hostname) && new URL(url).hostname.includes('cifralize') ? 'cifralize' : 'cifraclub'
  const node = source === 'cifralize' ? $('.chords-display').first() : $('.cifra_cnt pre, pre.cifra, main#chordPage pre').first()
  const text = node.html()?.replace(/<br\s*\/?\s*>/gi, '\n')
  const lines = text ? cheerio.load(`<pre>${text}</pre>`)('pre').text().replace(/\r/g, '').split('\n') : []
  const title = $('h1.t1, main#chordPage h1, h1').first().text().trim()
  const artist = $('h2.t3 a, h2.t3, main#chordPage h1 + a h2').first().text().trim() || (source === 'cifralize' ? title.split(/\s[-–]\s/).slice(1).join(' - ') : '')
  if (!lines.some((line) => /^\s*(?:\[[^\]]+\]\s*)?[A-G][#b]?(?:m|maj|sus|add|dim|aug|\d|\s|\/|$)/.test(line)) || !title || !artist) throw Error('INVALID_CONTENT')
  const toneText = source === 'cifralize' ? $('.transpose-key-btn.active').first().text() : $('#cifra_tom a, #cifra_tom, [data-tone]').first().text()
  const original_tone = toneText.trim().match(/(?:^|Tom:\s*)([A-G][#b]?m?)(?:\s|$|\()/)?.[1] ?? null
  const body = $('body').text()
  const capo = body.match(/capotra?ste[^\d]{0,40}(\d{1,2})\s*[ªa]?\s*casa/i)
  const capo_frets = capo ? Number(capo[1]) : /sem capotra?ste/i.test(body) ? 0 : null
  const youtube = html.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)
  const transposition_supported = !lines.some((line) => /^\s*[eBGDAE]?\s*\|[-\d~hp/\\x| ]{3,}/.test(line))
  return OriginalCifraSchema.parse({ contract_version: 2, parser_version: '2', source, cipher_url: url, artist, name: source === 'cifralize' ? title.split(/\s[-–]\s/)[0] : title, original_lines: lines, original_tone, capo_frets, youtube_url: youtube ? `https://www.youtube.com/watch?v=${youtube[1]}` : null, transposition_supported, warnings: [...(!original_tone ? ['NO_TONE'] : []), ...(capo_frets === null ? ['UNKNOWN_CAPO'] : []), ...(!transposition_supported ? ['UNSUPPORTED_TRANSPOSE'] : [])] })
}

export function createBrowserExtractor(manager) {
  return async ({ url, signal, onState }) => manager.withPage(async (page) => {
    await page.route('**/*', (route) => {
      try {
        assertAllowedDestination(route.request().url(), ['8.8.8.8']) // DNS/IP enforcement happens in the mandatory proxy.
        return ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue()
      } catch { return route.abort() }
    })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
    if (response?.status() !== 200) throw Error(response?.status() === 404 ? 'NOT_FOUND' : response?.status() === 403 ? 'BLOCKED' : 'UPSTREAM_FAILED')
    if (!['www.cifraclub.com.br', 'cifraclub.com.br'].includes(new URL(page.url()).hostname)) throw Error('INVALID_DESTINATION')
    await page.locator('.cifra_cnt pre, pre.cifra, main#chordPage pre').first().waitFor({ timeout: 10000 })
    onState?.('validating')
    const html = await page.content()
    if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw Error('PAYLOAD_TOO_LARGE')
    return parseCifraHtml(html, url)
  }, signal)
}
