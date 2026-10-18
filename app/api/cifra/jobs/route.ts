import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSongImportContext } from '@/lib/cifra/authorization'
import { deriveOwner, deriveJobId } from '@/lib/cifra/job-owner'
import { canonicalizeCifraUrl } from '@/lib/cifra/url'
import { createImportJob, ImportServiceError } from '@/lib/cifra/service-client'
import { assertImportEnabled, assertSameOrigin, importError, noStore, readSmallJson } from '@/lib/cifra/route-utils'
export const runtime = 'nodejs'
const inputSchema = z.object({ url: z.string().max(2048), requestId: z.string().uuid() }).strict()
export async function POST(request: Request) {
  try {
    assertImportEnabled(); assertSameOrigin(request)
    const owner = deriveOwner(await requireSongImportContext())
    const input = inputSchema.parse(await readSmallJson(request))
    let url: string
    try { url = canonicalizeCifraUrl(input.url).canonicalUrl } catch { throw new ImportServiceError('INVALID_URL', 400) }
    const result = await createImportJob({ ...owner, jobId: deriveJobId(owner.ownerRef, input.requestId), url }, request.signal)
    return NextResponse.json(result, { status: 202, headers: noStore })
  } catch (error) { return importError(error) }
}
