import * as cheerio from 'cheerio'

const urls = [
  'https://www.cifraclub.com.br/ministerio-morada/so-tu-s-santo/',
  'https://www.cifraclub.com.br/ministerio-morada/so-tu-s-santo/simplificada.html',
]

for (const url of urls) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' },
  })
  const html = await res.text()
  const $ = cheerio.load(html)

  const payloadMatches = [...html.matchAll(/(?:youtubeId|videoId)\s*[:=]\s*["']?([A-Za-z0-9_-]{11})/gi)]
    .map((m) => ({ key: m[0].includes('youtubeId') ? 'youtubeId' : 'videoId', id: m[1] }))

  const iframeIds = []
  $('iframe[src*="youtube"]').each((_, el) => {
    const src = $(el).attr('src') || ''
    const m = src.match(/(?:embed\/|watch\?v=|v\/)([A-Za-z0-9_-]{11})/)
    if (m) iframeIds.push(m[1])
  })

  console.log('\n===', url, '===')
  console.log('payload ids:', payloadMatches.slice(0, 8))
  console.log('iframe ids:', [...new Set(iframeIds)])
}
