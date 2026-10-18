import { JobViewSchema, type JobView } from './contract'
import { z } from 'zod'

export class ImportServiceError extends Error {
  constructor(public code: string, public status: number, public retryAfterSec?: number) { super(code) }
}
export async function callImporter(path: string, method: string, owner: { ownerRef: string; churchRef: string }, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const base = process.env.CIFRACLUB_IMPORTER_URL?.replace(/\/+$/, ''), token = process.env.CIFRACLUB_IMPORTER_TOKEN
  if (!base || !token) throw new ImportServiceError('NOT_CONFIGURED', 503)
  try {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-cifra-owner': owner.ownerRef, 'x-cifra-church': owner.churchRef }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error' })
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
    if (reader) while (true) {
      const item = await reader.read(); if (item.done) break
      size += item.value.byteLength
      if (size > 512 * 1024) { await reader.cancel(); throw new ImportServiceError('INVALID_RESPONSE', 502) }
      chunks.push(item.value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    const value = JSON.parse(text || '{}')
    if (!response.ok) throw new ImportServiceError(typeof value.code === 'string' ? value.code : 'UPSTREAM_FAILED', response.status, Number(response.headers.get('Retry-After')) || undefined)
    return value
  } catch (error) {
    if (error instanceof ImportServiceError) throw error
    throw new ImportServiceError(signal.aborted ? 'CANCELLED' : 'UPSTREAM_TIMEOUT', 504)
  }
}
export async function probeImporter(owner: { ownerRef: string; churchRef: string }, signal: AbortSignal) {
  return z.object({ ready: z.literal(true), contract_version: z.literal(2) }).parse(await callImporter('/ready', 'GET', owner, signal))
}
export async function createImportJob(input: { jobId: string; ownerRef: string; churchRef: string; url: string }, signal: AbortSignal): Promise<JobView> {
  return JobViewSchema.parse(await callImporter('/jobs', 'POST', input, signal, { jobId: input.jobId, url: input.url }))
}
export async function readImportJob(jobId: string, owner: { ownerRef: string; churchRef: string }, signal: AbortSignal): Promise<JobView> { return JobViewSchema.parse(await callImporter(`/jobs/${jobId}`, 'GET', owner, signal)) }
export async function cancelImportJob(jobId: string, owner: { ownerRef: string; churchRef: string }, signal: AbortSignal): Promise<JobView> { return JobViewSchema.parse(await callImporter(`/jobs/${jobId}`, 'DELETE', owner, signal)) }
