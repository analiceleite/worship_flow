import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type EventType = 'thursday' | 'sunday'

type MinisterRow = {
    id: string
    name: string
}

type RoleRow = {
    id: string
    name: string
}

type AssignmentRow = {
    id: string
    quarter_id: string
    role_id: string
    minister_id: string | null
    event_date: string
    event_type: EventType
}

type QuarterRow = {
    id: string
    name: string
    start_date: string
    end_date: string
}

type ParsedDateInfo = {
    columnIndex: number
    eventDate: string | null
    raw: string
}

type PreviewStatus =
    | 'ready'
    | 'ambiguous'
    | 'not-found'
    | 'invalid-role'
    | 'invalid-date'
    | 'assignment-not-found'

function normalizeText(value: string) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

function toDateString(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function eventTypeFromSheetName(sheetName: string): EventType {
    const normalized = normalizeText(sheetName)
    if (normalized.includes('domingo') || normalized.includes('sunday')) {
        return 'sunday'
    }

    return 'thursday'
}

function monthFromPtToken(token: string): number | null {
    const normalized = token.toLowerCase().replace('.', '')
    const monthMap: Record<string, number> = {
        jan: 1,
        fev: 2,
        mar: 3,
        abr: 4,
        mai: 5,
        jun: 6,
        jul: 7,
        ago: 8,
        set: 9,
        out: 10,
        nov: 11,
        dez: 12,
    }

    return monthMap[normalized] ?? null
}

function resolveYearForMonthDay(day: number, month: number, quarter: QuarterRow): number | null {
    const quarterStart = new Date(`${quarter.start_date}T12:00:00`)
    const quarterEnd = new Date(`${quarter.end_date}T12:00:00`)

    const candidateYears = Array.from(
        new Set([
            quarterStart.getFullYear() - 1,
            quarterStart.getFullYear(),
            quarterStart.getFullYear() + 1,
            quarterEnd.getFullYear(),
            quarterEnd.getFullYear() + 1,
        ])
    )

    for (const year of candidateYears) {
        const candidate = new Date(year, month - 1, day)
        if (Number.isNaN(candidate.getTime())) continue

        if (candidate >= quarterStart && candidate <= quarterEnd) {
            return year
        }
    }

    return quarterStart.getFullYear()
}

function parseDateCell(rawCell: unknown, quarter: QuarterRow): string | null {
    if (rawCell instanceof Date && !Number.isNaN(rawCell.getTime())) {
        return toDateString(rawCell)
    }

    if (typeof rawCell === 'number') {
        const parsed = XLSX.SSF.parse_date_code(rawCell)
        if (!parsed) return null

        const date = new Date(parsed.y, parsed.m - 1, parsed.d)
        if (Number.isNaN(date.getTime())) return null
        return toDateString(date)
    }

    const raw = String(rawCell ?? '').trim()
    if (!raw) return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw
    }

    const numericPattern = raw.match(/^(\d{1,2})[\/-](\d{1,2})$/)
    if (numericPattern) {
        const day = Number(numericPattern[1])
        const month = Number(numericPattern[2])
        const year = resolveYearForMonthDay(day, month, quarter)
        if (!year) return null

        return toDateString(new Date(year, month - 1, day))
    }

    const ptPattern = raw.match(/^(\d{1,2})-(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?$/i)
    if (ptPattern) {
        const day = Number(ptPattern[1])
        const month = monthFromPtToken(ptPattern[2])
        if (!month) return null
        const year = resolveYearForMonthDay(day, month, quarter)
        if (!year) return null

        return toDateString(new Date(year, month - 1, day))
    }

    return null
}

function isWithinQuarter(eventDate: string, quarter: QuarterRow) {
    return eventDate >= quarter.start_date && eventDate <= quarter.end_date
}

function findHeaderRowIndex(rows: unknown[][]): number {
    for (let i = 0; i < rows.length; i += 1) {
        const firstCell = normalizeText(String(rows[i]?.[0] ?? ''))
        if (firstCell === 'funcoes' || firstCell === 'role_name') {
            return i
        }
    }

    return -1
}

function buildMinisterIndex(ministers: MinisterRow[]) {
    const byNormalized = new Map<string, MinisterRow[]>()

    for (const minister of ministers) {
        const normalized = normalizeText(minister.name)
        const current = byNormalized.get(normalized) ?? []
        current.push(minister)
        byNormalized.set(normalized, current)
    }

    return { byNormalized }
}

function findMinisterMatches(rawName: string, ministers: MinisterRow[], ministerIndex: ReturnType<typeof buildMinisterIndex>) {
    const trimmed = rawName.trim()
    if (!trimmed) return []

    const parts = trimmed
        .split(/[\/;,]/)
        .map((part) => part.trim())
        .filter(Boolean)

    const tokens = parts.length > 0 ? parts : [trimmed]
    const candidates = new Map<string, MinisterRow>()

    for (const token of tokens) {
        const normalizedToken = normalizeText(token)
        const exactMatches = ministerIndex.byNormalized.get(normalizedToken)

        if (exactMatches?.length) {
            for (const m of exactMatches) {
                candidates.set(m.id, m)
            }
            continue
        }

        const startsWithMatches = ministers.filter((minister) =>
            normalizeText(minister.name).startsWith(normalizedToken)
        )

        if (startsWithMatches.length === 1) {
            candidates.set(startsWithMatches[0].id, startsWithMatches[0])
            continue
        }

        if (startsWithMatches.length > 1) {
            for (const m of startsWithMatches) {
                candidates.set(m.id, m)
            }
            continue
        }

        const includesMatches = ministers.filter((minister) =>
            normalizeText(minister.name).includes(normalizedToken)
        )

        if (includesMatches.length === 1) {
            candidates.set(includesMatches[0].id, includesMatches[0])
        }
    }

    return Array.from(candidates.values())
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

    const body = await request.json().catch(() => ({}))
    const workbookBase64 = String(body?.workbook_base64 ?? '').trim()

    if (!workbookBase64) {
        return NextResponse.json({ error: 'Arquivo não informado para prévia' }, { status: 400 })
    }

    let workbook: XLSX.WorkBook
    try {
        const buffer = Buffer.from(workbookBase64, 'base64')
        workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
        return NextResponse.json({ error: 'Não foi possível ler o arquivo da planilha' }, { status: 400 })
    }

    const adminSupabase = createAdminClient()

    const [quarterRes, rolesRes, assignmentsRes, ministersRes] = await Promise.all([
        adminSupabase
            .from('schedule_quarters')
            .select('id, name, start_date, end_date')
            .eq('id', id)
            .maybeSingle(),
        adminSupabase
            .from('schedule_roles')
            .select('id, name')
            .order('display_order', { ascending: true }),
        adminSupabase
            .from('schedule_assignments')
            .select('id, quarter_id, role_id, minister_id, event_date, event_type')
            .eq('quarter_id', id),
        adminSupabase
            .from('ministers')
            .select('id, name')
            .eq('is_active', true)
            .order('name', { ascending: true }),
    ])

    if (quarterRes.error) {
        return NextResponse.json({ error: quarterRes.error.message }, { status: 500 })
    }

    if (!quarterRes.data) {
        return NextResponse.json({ error: 'Bimestre não encontrado' }, { status: 404 })
    }

    if (rolesRes.error) {
        return NextResponse.json({ error: rolesRes.error.message }, { status: 500 })
    }

    if (assignmentsRes.error) {
        return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 })
    }

    if (ministersRes.error) {
        return NextResponse.json({ error: ministersRes.error.message }, { status: 500 })
    }

    const quarter = quarterRes.data as QuarterRow
    const roles = (rolesRes.data ?? []) as RoleRow[]
    const assignments = (assignmentsRes.data ?? []) as AssignmentRow[]
    const ministers = (ministersRes.data ?? []) as MinisterRow[]

    const roleMap = new Map<string, RoleRow>()
    for (const role of roles) {
        roleMap.set(normalizeText(role.name), role)
    }

    const assignmentMap = new Map<string, AssignmentRow>()
    for (const assignment of assignments) {
        const key = `${assignment.role_id}_${assignment.event_date}_${assignment.event_type}`
        assignmentMap.set(key, assignment)
    }

    const ministerIndex = buildMinisterIndex(ministers)

    const items: Array<{
        id: string
        sheet_name: string
        row_index: number
        event_type: EventType
        role_name: string
        event_date: string | null
        raw_minister_name: string
        assignment_id: string | null
        current_minister_id: string | null
        matched_ministers: MinisterRow[]
        status: PreviewStatus
        message: string
    }> = []

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue

        const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
            defval: '',
            blankrows: false,
        }) as unknown[][]

        const headerRowIndex = findHeaderRowIndex(rows)
        if (headerRowIndex < 0) continue

        const headerRow = rows[headerRowIndex] ?? []
        const parsedDates: ParsedDateInfo[] = []
        for (let col = 1; col < headerRow.length; col += 1) {
            const raw = String(headerRow[col] ?? '').trim()
            if (!raw) continue

            const eventDate = parseDateCell(headerRow[col], quarter)
            parsedDates.push({
                columnIndex: col,
                eventDate,
                raw,
            })
        }

        const eventType = eventTypeFromSheetName(sheetName)

        for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex] ?? []
            const roleName = String(row[0] ?? '').trim()
            if (!roleName) continue

            const role = roleMap.get(normalizeText(roleName))

            for (const parsedDate of parsedDates) {
                const rawMinisterName = String(row[parsedDate.columnIndex] ?? '').trim()
                if (!rawMinisterName) continue

                const itemId = `${sheetName}_${rowIndex}_${parsedDate.columnIndex}`

                if (!role) {
                    items.push({
                        id: itemId,
                        sheet_name: sheetName,
                        row_index: rowIndex + 1,
                        event_type: eventType,
                        role_name: roleName,
                        event_date: parsedDate.eventDate,
                        raw_minister_name: rawMinisterName,
                        assignment_id: null,
                        current_minister_id: null,
                        matched_ministers: [],
                        status: 'invalid-role',
                        message: `Função não encontrada no sistema: ${roleName}`,
                    })
                    continue
                }

                if (!parsedDate.eventDate || !isWithinQuarter(parsedDate.eventDate, quarter)) {
                    items.push({
                        id: itemId,
                        sheet_name: sheetName,
                        row_index: rowIndex + 1,
                        event_type: eventType,
                        role_name: roleName,
                        event_date: parsedDate.eventDate,
                        raw_minister_name: rawMinisterName,
                        assignment_id: null,
                        current_minister_id: null,
                        matched_ministers: [],
                        status: 'invalid-date',
                        message: `Data inválida ou fora do bimestre: ${parsedDate.raw}`,
                    })
                    continue
                }

                const assignmentKey = `${role.id}_${parsedDate.eventDate}_${eventType}`
                const assignment = assignmentMap.get(assignmentKey)

                if (!assignment) {
                    items.push({
                        id: itemId,
                        sheet_name: sheetName,
                        row_index: rowIndex + 1,
                        event_type: eventType,
                        role_name: roleName,
                        event_date: parsedDate.eventDate,
                        raw_minister_name: rawMinisterName,
                        assignment_id: null,
                        current_minister_id: null,
                        matched_ministers: [],
                        status: 'assignment-not-found',
                        message: 'Não existe célula correspondente na grade do bimestre',
                    })
                    continue
                }

                const matchedMinisters = findMinisterMatches(rawMinisterName, ministers, ministerIndex)

                if (matchedMinisters.length === 0) {
                    items.push({
                        id: itemId,
                        sheet_name: sheetName,
                        row_index: rowIndex + 1,
                        event_type: eventType,
                        role_name: roleName,
                        event_date: parsedDate.eventDate,
                        raw_minister_name: rawMinisterName,
                        assignment_id: assignment.id,
                        current_minister_id: assignment.minister_id,
                        matched_ministers: [],
                        status: 'not-found',
                        message: `Ministro não encontrado: ${rawMinisterName}`,
                    })
                    continue
                }

                if (matchedMinisters.length > 1) {
                    items.push({
                        id: itemId,
                        sheet_name: sheetName,
                        row_index: rowIndex + 1,
                        event_type: eventType,
                        role_name: roleName,
                        event_date: parsedDate.eventDate,
                        raw_minister_name: rawMinisterName,
                        assignment_id: assignment.id,
                        current_minister_id: assignment.minister_id,
                        matched_ministers: matchedMinisters,
                        status: 'ambiguous',
                        message: `Nome ambíguo: ${rawMinisterName}`,
                    })
                    continue
                }

                items.push({
                    id: itemId,
                    sheet_name: sheetName,
                    row_index: rowIndex + 1,
                    event_type: eventType,
                    role_name: roleName,
                    event_date: parsedDate.eventDate,
                    raw_minister_name: rawMinisterName,
                    assignment_id: assignment.id,
                    current_minister_id: assignment.minister_id,
                    matched_ministers: matchedMinisters,
                    status: 'ready',
                    message: 'Correspondência encontrada',
                })
            }
        }
    }

    const summary = {
        total_items: items.length,
        ready_items: items.filter((item) => item.status === 'ready').length,
        ambiguous_items: items.filter((item) => item.status === 'ambiguous').length,
        not_found_items: items.filter((item) => item.status === 'not-found').length,
        invalid_items: items.filter((item) =>
            item.status === 'invalid-role' ||
            item.status === 'invalid-date' ||
            item.status === 'assignment-not-found'
        ).length,
    }

    return NextResponse.json({
        quarter,
        ministers,
        summary,
        items,
    })
}
