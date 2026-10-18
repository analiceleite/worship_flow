import { NextResponse } from 'next/server'
import { requireSongImportContext } from '@/lib/cifra/authorization'
import { deriveOwner } from '@/lib/cifra/job-owner'
import { readImportJob, cancelImportJob, ImportServiceError } from '@/lib/cifra/service-client'
import { assertImportEnabled, assertSameOrigin, importError, noStore } from '@/lib/cifra/route-utils'
export const runtime = 'nodejs'
type Context = { params: Promise<{ jobId: string }> }
async function handle(request: Request, context: Context, cancel: boolean) {
  try {
    assertImportEnabled(); if (cancel) assertSameOrigin(request)
    const owner = deriveOwner(await requireSongImportContext())
    const { jobId } = await context.params
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ImportServiceError('INVALID_INPUT', 400)
    const result = await (cancel ? cancelImportJob : readImportJob)(jobId, owner, request.signal)
    return NextResponse.json(result, { headers: noStore })
  } catch (error) { return importError(error) }
}
export const GET = (request: Request, context: Context) => handle(request, context, false)
export const DELETE = (request: Request, context: Context) => handle(request, context, true)
