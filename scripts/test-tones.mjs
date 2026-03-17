import * as cheerio from 'cheerio'

const TONE_ALIASES = { Db: 'C#', Eb: 'D#', Gb: 'F#', Bb: 'A#', Dbm: 'C#m', Ebm: 'D#m', Gbm: 'F#m', Bbm: 'A#m' }
const normalizeTone = (raw) => {
  const c = raw.trim().replace(/\s+/g, '')
  if (!/^[A-G][#b]?m?$/.test(c)) return null
  const u = c[0].toUpperCase() + c.slice(1)
  return TONE_ALIASES[u] ?? u
}

const res = await fetch('https://www.cifraclub.com.br/felipe-rodrigues/nome-mais-doce-part-elizeu-rodrigues/', {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' }
})
const html = await res.text()
const $ = cheerio.load(html)

// Available tones via #side-tom ul li (skip first "½ Tom" label)
const tones = []
$('#side-tom ul li').slice(1).each((_, el) => {
  const raw = $(el).contents().filter((_, n) => n.type === 'text').text().trim()
  const t = normalizeTone(raw)
  if (t) tones.push(t)
})
console.log('Available tones:', tones.join(', '))

// Current tone via #cifra_tom
const cifraTomel = $('#cifra_tom').text()
const tomMatch = cifraTomel.match(/([A-G][#b]?m?)\s*$/i)
const tone = tomMatch ? (normalizeTone(tomMatch[1]) ?? '[alias failed]') : '[not found]'
console.log('Current tone:', tone)
