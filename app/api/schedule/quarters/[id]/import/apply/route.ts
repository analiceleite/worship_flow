import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileMinisterCalendar } from '@/lib/google-calendar/reconcile'

interface ApplyItem {
    assignment_id: string
    minister_id: string | null
    is_trainee?: boolean
}

interface ApplyPayload {
    items?: ApplyItem[]
}

interface AssignmentApplyRow {
    id: string
    quarter_id: string
    minister_id: string | null
    is_trainee: boolean
    role: { category: string } | null
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json().catch(() => ({}))) as ApplyPayload
    const items = payload.items ?? []

    if (!items.length) {
        return NextResponse.json({ error: 'Nenhuma alteração informada para aplicar' }, { status: 400 })
    }

    const assignmentIds = Array.from(new Set(items.map((item) => item.assignment_id).filter(Boolean)))
    if (!assignmentIds.length) {
        return NextResponse.json({ error: 'Nenhuma célula válida para aplicar' }, { status: 400 })
    }

    const adminSupabase = createAdminClient()

    const { data: assignments, error: assignmentsError } = await adminSupabase
        .from('schedule_assignments')
        .select('id, quarter_id, minister_id, is_trainee, role:schedule_roles(category)')
        .in('id', assignmentIds)
        .eq('quarter_id', id)

    if (assignmentsError) {
        return NextResponse.json({ error: assignmentsError.message }, { status: 500 })
    }

    const assignmentMap = new Map(
        ((assignments ?? []) as AssignmentApplyRow[]).map((row) => [row.id, row])
    )

    const selectedMinisterIds = Array.from(
        new Set(items.map((item) => item.minister_id).filter((value): value is string => Boolean(value)))
    )
    const selectedMinisterRoleMap = new Map<string, string>()

    if (selectedMinisterIds.length) {
        const { data: selectedMinisters, error: selectedMinistersError } = await adminSupabase
            .from('ministers')
            .select('id, role')
            .in('id', selectedMinisterIds)

        if (selectedMinistersError) {
            return NextResponse.json({ error: selectedMinistersError.message }, { status: 500 })
        }

        for (const minister of selectedMinisters ?? []) {
            selectedMinisterRoleMap.set(minister.id, minister.role)
        }
    }

    let updatedCount = 0
    let skippedCount = 0
    const affectedMinisterIds = new Set<string>()

    for (const item of items) {
        const assignment = assignmentMap.get(item.assignment_id)
        if (!assignment) {
            skippedCount += 1
            continue
        }

        const nextMinisterId = item.minister_id ?? null
        const nextIsTrainee = nextMinisterId ? Boolean(item.is_trainee) : false

        const invalidMediaAssignment =
            assignment.role?.category === 'midia' &&
            nextMinisterId &&
            selectedMinisterRoleMap.get(nextMinisterId) !== 'midia'

        if (invalidMediaAssignment) {
            return NextResponse.json(
                { error: 'A função Sonoplasta aceita apenas usuários do grupo Mídia' },
                { status: 400 }
            )
        }

        const noChanges =
            assignment.minister_id === nextMinisterId &&
            Boolean(assignment.is_trainee) === nextIsTrainee

        if (noChanges) {
            skippedCount += 1
            continue
        }

        const { error: updateError } = await adminSupabase
            .from('schedule_assignments')
            .update({
                minister_id: nextMinisterId,
                is_trainee: nextIsTrainee,
            })
            .eq('id', assignment.id)

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        if (assignment.minister_id) affectedMinisterIds.add(assignment.minister_id)
        if (nextMinisterId) affectedMinisterIds.add(nextMinisterId)

        updatedCount += 1
    }

    for (const ministerId of affectedMinisterIds) {
        try {
            await reconcileMinisterCalendar(ministerId)
        } catch (syncError) {
            console.error('Erro ao sincronizar Google Calendar após aplicação em lote:', syncError)
        }
    }

    return NextResponse.json({
        ok: true,
        updated_count: updatedCount,
        skipped_count: skippedCount,
    })
}
