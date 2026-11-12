import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { firstSteps } from '@/lib/onboarding/rules'

const noStore = { 'Cache-Control': 'no-store' }

// WF-26 first steps: progress is computed from the church's real data only.
export async function GET() {
  try {
    const context = await getCurrentMinisterContext({ requireAdmin: true })
    const admin = createAdminClient()
    const churchId = context.churchId
    const [members, songs, quarters] = await Promise.all([
      admin.from('ministers').select('id', { count: 'exact', head: true })
        .eq('church_id', churchId).eq('access_state', 'active'),
      admin.from('songs').select('id', { count: 'exact', head: true }).eq('church_id', churchId),
      admin.from('schedule_quarters').select('id', { count: 'exact', head: true }).eq('church_id', churchId),
    ])
    if (members.error || songs.error || quarters.error) {
      return NextResponse.json({ error: 'Não foi possível calcular seus primeiros passos.' }, { status: 503, headers: noStore })
    }
    const steps = firstSteps({
      activeMembers: members.count ?? 0,
      songs: songs.count ?? 0,
      quarters: quarters.count ?? 0,
    })
    return NextResponse.json({ steps, complete: steps.every(step => step.done) }, { headers: noStore })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore })
    }
    return NextResponse.json({ error: 'Não foi possível calcular seus primeiros passos.' }, { status: 503, headers: noStore })
  }
}
