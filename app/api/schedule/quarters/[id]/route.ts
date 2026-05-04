import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
    _request: Request,
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

    const adminSupabase = createAdminClient()

    const { data: existingQuarter, error: fetchError } = await adminSupabase
        .from('schedule_quarters')
        .select('id, name')
        .eq('id', id)
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
        .eq('quarter_id', id)

    if (notificationsError) {
        return NextResponse.json({ error: notificationsError.message }, { status: 500 })
    }

    const { error: rehearsalsError } = await adminSupabase
        .from('schedule_rehearsals')
        .delete()
        .eq('quarter_id', id)

    if (rehearsalsError) {
        return NextResponse.json({ error: rehearsalsError.message }, { status: 500 })
    }

    const { error: assignmentsError } = await adminSupabase
        .from('schedule_assignments')
        .delete()
        .eq('quarter_id', id)

    if (assignmentsError) {
        return NextResponse.json({ error: assignmentsError.message }, { status: 500 })
    }

    const { error: quarterDeleteError } = await adminSupabase
        .from('schedule_quarters')
        .delete()
        .eq('id', id)

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
