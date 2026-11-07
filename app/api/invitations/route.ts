import { NextResponse } from 'next/server'
import { z } from 'zod'
import { INSTRUMENTS } from '@/lib/types'
import { isTrustedMutationOrigin } from '@/lib/auth/request-origin'
import { getInvitationAdminContext, invitationErrorResponse, noStoreHeaders } from '@/lib/invitations/api'
import { createInvitation, listInvitations, normalizeInvitationEmail } from '@/lib/invitations/server'

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(200),
  role: z.enum(['admin', 'minister', 'midia']),
  instrument: z.string().trim().max(300).optional().default(''),
}).strict()

const allowedInstruments = new Set<string>(INSTRUMENTS)

function normalizeInstrument(role: 'admin' | 'minister' | 'midia', raw: string): string | null {
  if (role === 'midia') return 'Midia'
  const parts = [...new Set(raw.split(',').map(part => part.trim()).filter(Boolean))]
  if (parts.length === 0 || parts.some(part => !allowedInstruments.has(part))) return null
  return parts.join(', ')
}

export async function GET() {
  try {
    const context = await getInvitationAdminContext()
    const invitations = await listInvitations(context.churchId)
    return NextResponse.json({ invitations }, { headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await getInvitationAdminContext()
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const body = createSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'Informe nome, e-mail, papel e funções válidos.' }, { status: 400 })
    }
    const instrument = normalizeInstrument(body.data.role, body.data.instrument)
    if (!instrument) {
      return NextResponse.json({ error: 'Selecione ao menos uma função musical válida.' }, { status: 400 })
    }

    const created = await createInvitation({
      actorUserId: context.userId,
      churchId: context.churchId,
      email: normalizeInvitationEmail(body.data.email),
      name: body.data.name,
      role: body.data.role,
      instrument,
    })

    return NextResponse.json({
      invitation: {
        id: created.invitation_id,
        email: created.email,
        name: created.name,
        role: created.role,
        instrument: created.instrument,
        version: created.version,
        expires_at: created.expires_at,
      },
      delivery: created.delivery,
    }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
