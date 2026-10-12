import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    let context
    try {
        context = await getCurrentMinisterContext({ requireAdmin: true })
    } catch (error) {
        if (error instanceof AuthContextError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
        }
        throw error
    }

    const adminSupabase = createAdminClient()

    const { data: existingQuarter, error: fetchError } = await adminSupabase
        .from('schedule_quarters')
        .select('id, name')
        .eq('id', id)
        .eq('church_id', context.churchId)
        .maybeSingle()

    if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!existingQuarter) {
        return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
    }

    const { error: notificationsError } = await adminSupabase
        .from('schedule_email_notifications')
        .delete()
        .eq('church_id', context.churchId)
        .eq('quarter_id', id)

    if (notificationsError) {
        return NextResponse.json({ error: notificationsError.message }, { status: 500 })
    }

    const { error: rehearsalsError } = await adminSupabase
        .from('schedule_rehearsals')
        .delete()
        .eq('church_id', context.churchId)
        .eq('quarter_id', id)

    if (rehearsalsError) {
        return NextResponse.json({ error: rehearsalsError.message }, { status: 500 })
    }

    const { error: assignmentsError } = await adminSupabase
        .from('schedule_assignments')
        .delete()
        .eq('church_id', context.churchId)
        .eq('quarter_id', id)

    if (assignmentsError) {
        return NextResponse.json({ error: assignmentsError.message }, { status: 500 })
    }

    const { error: quarterDeleteError } = await adminSupabase
        .from('schedule_quarters')
        .delete()
        .eq('id', id)
        .eq('church_id', context.churchId)

    if (quarterDeleteError) {
        return NextResponse.json({ error: quarterDeleteError.message }, { status: 500 })
    }

    return NextResponse.json({
        ok: true,
        deleted: {
            id: existingQuarter.id,
            name: existingQuarter.name,
        },
    })
}
