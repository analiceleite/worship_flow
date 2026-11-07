import { NextResponse } from 'next/server'
import { AuthContextError, getOwnMemberships } from '@/lib/auth-context'
import { getAuthenticatedIdentity } from '@/lib/auth/identity'

export async function GET() {
  try {
    const user = await getAuthenticatedIdentity()
    if (!user) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 })
    const memberships = await getOwnMemberships(user.id)
    return NextResponse.json({ memberships }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Não foi possível consultar seus vínculos.' }, { status: 503 })
  }
}
