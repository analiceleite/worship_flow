import http from 'node:http'
import net from 'node:net'
import { resolveDestination } from './network-policy.js'

export async function createEgressProxy({ resolve, connect = (options) => net.connect(options) } = {}) {
  const sockets = new Set()
  const server = http.createServer((_req, res) => { res.writeHead(405); res.end() })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setTimeout(35000, () => socket.destroy()) })
  server.on('connect', async (req, client, head) => {
    try {
      const destination = `https://${req.url}/`
      const entry = await resolveDestination(destination, resolve)
      if (client.destroyed) return
      const upstream = connect({ host: entry.address, port: 443, family: entry.family })
      sockets.add(upstream)
      upstream.on('close', () => { sockets.delete(upstream); client.destroy() })
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream.destroy())
      client.on('close', () => upstream.destroy())
      upstream.setTimeout(35000, () => upstream.destroy())
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client); client.pipe(upstream)
      })
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)) } }
}
