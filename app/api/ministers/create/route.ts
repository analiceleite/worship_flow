import { NextResponse } from 'next/server'

// Creating accounts with a temporary password is retired. Administrators invite
// people through /api/invitations; the person sets their own credential on accept.
export async function POST() {
  return NextResponse.json(
    { error: 'Criação com senha temporária foi desativada. Envie um convite pela tela de equipe.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
