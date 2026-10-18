// @vitest-environment node
import { expect, test } from 'vitest'

test('rejects_private_destinations_before_connect', async () => {
  const { assertAllowedDestination } = await import('../../services/cifraclub-importer/src/network-policy.js')
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', '2001:db8::1']) expect(() => assertAllowedDestination('https://www.cifraclub.com.br/a/b/', [ip])).toThrow()
  expect(() => assertAllowedDestination('https://evil.com/', ['8.8.8.8'])).toThrow()
  expect(() => assertAllowedDestination('https://www.cifraclub.com.br/a/b/', ['8.8.8.8'])).not.toThrow()
})

test('extracts_only_identified_musical_content_with_unknown_values_preserved', async () => {
  const { parseCifraHtml } = await import('../../services/cifraclub-importer/src/extract.js')
  const html = '<h1 class="t1">Musica</h1><h2 class="t3"><a>Artista</a></h2><div class="cifra_cnt"><pre>G   D\nUma letra</pre></div>'
  const result = parseCifraHtml(html, 'https://www.cifraclub.com.br/artista/musica/')
  expect(result.original_lines).toEqual(['G   D', 'Uma letra'])
  expect(result.original_tone).toBeNull()
  expect(result.capo_frets).toBeNull()
  expect(() => parseCifraHtml('<h1>Erro</h1><pre>Access denied</pre>', result.cipher_url)).toThrow()
})

test('browser_reuses_process_but_closes_each_isolated_context', async () => {
  const { createBrowserManager } = await import('../../services/cifraclub-importer/src/browser.js')
  let launches = 0, contexts = 0, closed = 0
  const manager = createBrowserManager({ launch: async () => { launches++; return { isConnected: () => true, close: async () => {}, newContext: async () => { contexts++; return { newPage: async () => ({ value: 42 }), close: async () => { closed++ } } } } } })
  expect(await manager.withPage(async (page: { value: number }) => page.value, new AbortController().signal)).toBe(42)
  await manager.withPage(async () => { throw Error('test failure') }, new AbortController().signal).catch(() => {})
  expect([launches, contexts, closed]).toEqual([1, 2, 2])
  await manager.close()
})
