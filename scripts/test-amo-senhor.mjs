#!/usr/bin/env node
/**
 * Teste específico para a música "Amo o Senhor"
 * URL: https://www.cifraclub.com.br/fernanda-brum/amo-senhor/gwwmhm.html#key=7
 */

import * as cheerio from 'cheerio'

const TONE_ALIASES = { Db: 'C#', Eb: 'D#', Gb: 'F#', Bb: 'A#', Dbm: 'C#m', Ebm: 'D#m', Gbm: 'F#m', Bbm: 'A#m' }

const normalizeTone = (raw) => {
  const c = raw.trim().replace(/\s+/g, '')
  if (!/^[A-G][#b]?m?$/.test(c)) return null
  const u = c[0].toUpperCase() + c.slice(1)
  return TONE_ALIASES[u] ?? u
}

console.log('=== TESTANDO: Amo o Senhor - Fernanda Brum ===\n')

const url = 'https://www.cifraclub.com.br/fernanda-brum/amo-senhor/gwwmhm.html'

try {
  console.log(`Fetching: ${url}`)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    }
  })

  const html = await res.text()
  const $ = cheerio.load(html)

  // Extrai o tom atual
  console.log('\n--- TOM EXTRAÇÃO ---')
  
  const toneFromAnchor = normalizeTone($('#cifra_tom a').first().text())
  console.log(`Tom via anchor (#cifra_tom a): ${toneFromAnchor || '[não encontrado]'}`)

  const cifraTomel = $('#cifra_tom').text()
  console.log(`Texto em #cifra_tom: "${cifraTomel.trim()}"`)
  
  const tomMatch = cifraTomel.match(/([A-G][#b]?m?)\s*(?:\(|$)/i)
  console.log(`Tom via regex: ${tomMatch ? normalizeTone(tomMatch[1]) : '[não encontrado]'}`)

  // Extrai tons disponíveis
  console.log('\n--- TONS DISPONÍVEIS ---')
  const tones = []
  $('#side-tom ul li').slice(1).each((_, el) => {
    const raw = $(el).contents().filter((_, n) => n.type === 'text').text().trim()
    const t = normalizeTone(raw)
    if (t) {
      tones.push(t)
      console.log(`  ${raw} → ${t}`)
    }
  })
  
  if (tones.length === 0) {
    console.log('  [Nenhum tom encontrado em #side-tom]')
  }

  // Extrai cifra
  console.log('\n--- PRIMEIRAS 10 LINHAS DA CIFRA ---')
  const cifraLines = []
  const preEl = $('.cifra_cnt pre').first()

  if (preEl.length) {
    preEl.text().split('\n').slice(0, 10).forEach((line, i) => {
      console.log(`${i + 1}: ${line}`)
      cifraLines.push(line)
    })
  } else {
    const altPreEl = $('pre').first()
    if (altPreEl.length) {
      altPreEl.text().split('\n').slice(0, 10).forEach((line, i) => {
        console.log(`${i + 1}: ${line}`)
        cifraLines.push(line)
      })
    } else {
      console.log('  [Nenhuma cifra encontrada]')
    }
  }

  console.log('\n=== RESUMO ===')
  console.log(`Tom extraído: ${toneFromAnchor || tomMatch ? normalizeTone(tomMatch?.[1]) : '[ERRO]'}`)
  console.log(`Tons disponíveis: ${tones.join(', ') || '[ERRO]'}`)
  console.log(`Linhas de cifra: ${cifraLines.length}`)

} catch (error) {
  console.error('Erro:', error.message)
}
