import { NextResponse } from 'next/server'
import { requireSongImportContext } from '@/lib/cifra/authorization'
import { saveImportedSong, SaveImportedSongSchema } from '@/lib/cifra/save-song'
import { assertImportEnabled, assertSameOrigin, importError, noStore, readSmallJson } from '@/lib/cifra/route-utils'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    assertImportEnabled(); assertSameOrigin(request)
    const context = await requireSongImportContext()
    const input = SaveImportedSongSchema.parse(await readSmallJson(request, 540 * 1024))
    return NextResponse.json(await saveImportedSong(input, context), { status: 201, headers: noStore })
  } catch (error) { return importError(error) }
}
