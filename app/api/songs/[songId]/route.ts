import { NextResponse } from 'next/server'
import { requireSongImportContext } from '@/lib/cifra/authorization'
import { saveImportedSong, SaveImportedSongSchema } from '@/lib/cifra/save-song'
import { assertImportEnabled, assertSameOrigin, importError, noStore, readSmallJson } from '@/lib/cifra/route-utils'
import { z } from 'zod'
export const runtime = 'nodejs'
export async function PATCH(request: Request, route: { params: Promise<{ songId: string }> }) {
  try {
    assertImportEnabled(); assertSameOrigin(request)
    const context = await requireSongImportContext()
    const { songId } = z.object({ songId: z.string().uuid() }).parse(await route.params)
    const input = SaveImportedSongSchema.parse(await readSmallJson(request, 540 * 1024))
    return NextResponse.json(await saveImportedSong(input, context, songId), { headers: noStore })
  } catch (error) { return importError(error) }
}
