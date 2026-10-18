import { NextResponse } from 'next/server'
import { requireSongImportContext } from '@/lib/cifra/authorization'
import { deriveOwner } from '@/lib/cifra/job-owner'
import { probeImporter, ImportServiceError } from '@/lib/cifra/service-client'
import { assertImportEnabled, assertSameOrigin, importError, noStore } from '@/lib/cifra/route-utils'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    assertImportEnabled(); assertSameOrigin(request)
    const owner = deriveOwner(await requireSongImportContext())
    try { return NextResponse.json(await probeImporter(owner, request.signal), { headers: noStore }) }
    catch (error) {
      if (error instanceof ImportServiceError && ['UPSTREAM_TIMEOUT', 'UPSTREAM_FAILED'].includes(error.code)) return NextResponse.json({ ready: false }, { status: 202, headers: noStore })
      throw error
    }
  } catch (error) { return importError(error) }
}
