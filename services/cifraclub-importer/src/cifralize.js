import { fetchSource } from './network-policy.js'
import { parseCifraHtml } from './extract.js'
export async function extractCifralize({ url, signal, onState }) {
  const html = await fetchSource(url, signal)
  onState?.('validating')
  return parseCifraHtml(html, url)
}
