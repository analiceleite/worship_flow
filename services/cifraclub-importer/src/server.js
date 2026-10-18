import http from 'node:http'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { readConfig } from './config.js'
import { authorize } from './auth.js'
import { createEgressProxy } from './egress-proxy.js'
import { createBrowserManager } from './browser.js'
import { createBrowserExtractor } from './extract.js'
import { extractCifralize } from './cifralize.js'
import { createJobManager } from './jobs.js'
import { handleImport } from './legacy-import.js'
import { assertAllowedDestination } from './network-policy.js'

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 || status === 503 ? { 'Retry-After': '5' } : {}) }); res.end(JSON.stringify(value))
}
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Object.assign(Error('PAYLOAD_TOO_LARGE'), { status: 413 }); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function createImportServer({ token, manager }) {
  const buckets = new Map()
  function rate(owner, kind, maximum) {
    const time = Date.now()
    for (const [key, entry] of buckets) if (entry.until <= time) buckets.delete(key)
    const key = `${owner}:${kind}`, entry = buckets.get(key) ?? { count: 0, until: time + 60000 }
    if (entry.count >= maximum || buckets.size >= 1000 && !buckets.has(key)) throw Object.assign(Error('RATE_LIMITED'), { status: 429 })
    entry.count++; buckets.set(key, entry)
  }
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true })
      authorize(req, token)
      if (req.method === 'POST' && req.url === '/import') return handleImport(req, res)
      const owner = req.headers['x-cifra-owner'], church = req.headers['x-cifra-church']
      if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner) || typeof church !== 'string' || !/^[a-f0-9]{64}$/.test(church)) return json(res, 400, { code: 'INVALID_OWNER' })
      if (req.method === 'GET' && req.url === '/ready') { rate(owner, 'ready', 60); return json(res, 200, { ready: true, contract_version: 2 }) }
      if (req.method === 'POST' && req.url === '/jobs') {
        const input = await body(req)
        if (typeof input.jobId !== 'string' || !/^[a-f0-9]{64}$/.test(input.jobId) || typeof input.url !== 'string' || input.url.length > 2048) return json(res, 400, { code: 'INVALID_INPUT' })
        const url = new URL(input.url)
        assertAllowedDestination(url.href, ['8.8.8.8'])
        const source = hosts.has(url.hostname) && url.hostname.includes('cifralize') ? 'cifralize' : 'cifraclub'
        if (!['www.cifraclub.com.br', 'cifraclub.com.br', 'cifralize.com.br', 'www.cifralize.com.br'].includes(url.hostname) || url.search || url.hash || !/^\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+\.html|\/?)$/.test(url.pathname)) return json(res, 400, { code: 'INVALID_URL' })
        return json(res, 202, manager.create({ jobId: input.jobId, ownerRef: owner, churchRef: church, canonicalUrl: url.href, source }))
      }
      const id = req.url?.match(/^\/jobs\/([a-f0-9]{64})$/)?.[1]
      if (id && req.method === 'GET') { rate(owner, 'poll', 120); return json(res, 200, manager.read(id, owner)) }
      if (id && req.method === 'DELETE') return json(res, 200, manager.cancel(id, owner))
      return json(res, 404, { code: 'NOT_FOUND' })
    } catch (error) { return json(res, error.status ?? 400, { code: error.status ? error.message : 'INVALID_REQUEST', error: 'Nao foi possivel processar a solicitacao.' }) }
  })
}

async function start() {
  const config = readConfig()
  const proxy = await createEgressProxy()
  const browser = createBrowserManager({ launch: () => chromium.launch({ headless: true, proxy: { server: proxy.url, bypass: '<-loopback>' }, args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }) })
  const extract = createBrowserExtractor(browser)
  const manager = createJobManager({ extract: (input) => input.source === 'cifralize' ? extractCifralize(input) : extract(input) })
  const server = createImportServer({ token: config.token, manager })
  server.requestTimeout = 10000; server.headersTimeout = 10000
  server.listen(config.port)
  let stopping = false
  const shutdown = async () => { if (stopping) return; stopping = true; server.close(); await manager.close(); await browser.close(); await proxy.close() }
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start().catch(() => { console.error('Importer startup failed; check configuration.'); process.exitCode = 1 })
