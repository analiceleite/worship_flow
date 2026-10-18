import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthContextError } from '@/lib/auth-context'
import { ImportServiceError } from './service-client'
export const noStore = { 'Cache-Control': 'private, no-store' }
export function assertImportEnabled() { if (process.env.CIFRA_IMPORT_V2_ENABLED !== 'true') throw new ImportServiceError('FEATURE_DISABLED', 503) }
export function assertSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new ImportServiceError('FORBIDDEN_ORIGIN', 403)
}
export async function readSmallJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new ImportServiceError('INVALID_INPUT', 400)
  const chunks: Uint8Array[] = []; let length = 0
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) { await reader.cancel(); throw new ImportServiceError('PAYLOAD_TOO_LARGE', 413) }; chunks.push(value) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function importError(error: unknown) {
  const status = error instanceof AuthContextError ? error.status : error instanceof ImportServiceError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 502
  const code = error instanceof ImportServiceError ? error.code : error instanceof AuthContextError ? 'UNAUTHORIZED' : status === 400 ? 'INVALID_INPUT' : 'IMPORT_FAILED'
  const retryAfter = error instanceof ImportServiceError ? error.retryAfterSec : undefined
  return NextResponse.json({ code, error: status === 403 ? 'Acesso não permitido.' : 'Não foi possível importar. Tente novamente ou envie PDF.' }, { status, headers: { ...noStore, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } })
}
