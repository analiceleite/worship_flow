import * as cheerio from 'cheerio'

const url = 'https://www.cifraclub.com.br/gabriela-rocha/eu-sou-teu-rooftops/'

const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    Accept: 'text/html',
  },
})

console.log('status:', res.status)
console.log('final url:', res.url)

const html = await res.text()
const $ = cheerio.load(html)

console.log('tone anchor:', $('#cifra_tom a').first().text().trim())
console.log('tone text:', $('#cifra_tom').first().text().replace(/\s+/g, ' ').trim())

const tones = []
$('#side-tom ul li').slice(1).each((_, el) => {
  const raw = $(el).contents().filter((_, n) => n.type === 'text').text().trim()
  if (raw) tones.push(raw)
})
console.log('tones:', tones.join(', '))

const preText = $('.cifra_cnt pre').first().text() || $('pre').first().text()
const lines = preText.split('\n').slice(0, 20)
console.log('first lines:\n' + lines.join('\n'))
