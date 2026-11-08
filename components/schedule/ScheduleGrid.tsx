'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, getISOWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '../ui/sheet'
import { selectedChurchFetch } from '@/lib/auth/client-context'

export interface ScheduleRole {
    id: string
    name: string
    category: 'ministro' | 'vocal' | 'instrumento' | 'midia'
    display_order: number
}

export interface AssignmentMinister {
    id: string
    name: string
    avatar_url?: string | null
}

export interface ScheduleAssignment {
    id: string
    quarter_id: string
    role_id: string
    minister_id: string | null
    is_trainee: boolean
    event_date: string
    event_type: 'thursday' | 'sunday'
    minister: AssignmentMinister | null
}

export interface ScheduleRehearsal {
    quarter_id: string
    event_date: string
    event_type: 'thursday' | 'sunday'
    rehearsal_date: string | null
    rehearsal_time: string | null
    rehearsal_place: string | null
}

export interface ScheduleEventControl {
    event_date: string
    event_type: 'thursday' | 'sunday'
    leader_minister_id: string | null
    status: 'scheduled' | 'cancelled'
    leader?: { id: string; name: string } | null
}

interface MinisterOption {
    id: string
    name: string
    email: string | null
    avatar_url?: string | null
}

interface SavePayload {
    id: string
    quarter_id: string
    role_id: string
    event_date: string
    event_type: 'thursday' | 'sunday'
    minister_id: string | null
    minister_name: string | null
    minister_avatar_url?: string | null
    is_trainee: boolean
}

interface ScheduleGridProps {
    roles: ScheduleRole[]
    dates: string[]
    eventType: 'thursday' | 'sunday'
    assignments: ScheduleAssignment[]
    savingKeys?: Record<string, boolean>
    onSaveAssignment?: (payload: SavePayload) => Promise<void>
    readOnly?: boolean
    highlightedMinisterId?: string | null
    rehearsalByDate?: Record<string, ScheduleRehearsal>
    rehearsalStatus?: 'ready' | 'loading' | 'error'
    canEditRehearsal?: boolean | ((eventDate: string, eventType: 'thursday' | 'sunday') => boolean)
    onSaveRehearsal?: (payload: {
        eventDate: string
        eventType: 'thursday' | 'sunday'
        rehearsalDate: string | null
        rehearsalTime: string | null
        rehearsalPlace: string | null
    }) => Promise<void>
    eventControls?: ScheduleEventControl[]
    activeMinisters?: AssignmentMinister[]
    isPublished?: boolean
    savingEventKeys?: Record<string, boolean>
    onSaveEventControl?: (payload: {
        eventDate: string
        eventType: 'thursday' | 'sunday'
        leaderMinisterId?: string | null
        action?: 'cancel' | 'reactivate'
    }) => Promise<void>
}

function toCellKey(roleId: string, date: string) {
    return `${roleId}_${date}`
}

function formatDate(dateStr: string) {
    return format(new Date(`${dateStr}T12:00:00`), "dd/MM (EEE)", { locale: ptBR })
}

function formatWeekTag(dateStr: string) {
    return `S${getISOWeek(new Date(`${dateStr}T12:00:00`))}`
}

function rehearsalSummary(rehearsal: ScheduleRehearsal | undefined) {
    if (!rehearsal) return 'Ensaio não informado'

    const parts: string[] = []
    if (rehearsal.rehearsal_date) {
        parts.push(format(new Date(`${rehearsal.rehearsal_date}T12:00:00`), 'dd/MM', { locale: ptBR }))
    }
    if (rehearsal.rehearsal_time) {
        parts.push(rehearsal.rehearsal_time.slice(0, 5))
    }
    if (rehearsal.rehearsal_place) {
        parts.push(rehearsal.rehearsal_place)
    }

    return parts.length ? parts.join(' • ') : 'Ensaio não informado'
}

function EventControlEditor({
    eventDate, eventType, assignments, controls, ministers, isPublished, saving, onSave,
}: {
    eventDate: string
    eventType: 'thursday' | 'sunday'
    assignments: ScheduleAssignment[]
    controls: ScheduleEventControl[]
    ministers: AssignmentMinister[]
    isPublished: boolean
    saving: boolean
    onSave?: ScheduleGridProps['onSaveEventControl']
}) {
    const control = controls.find(item => item.event_date === eventDate && item.event_type === eventType)
    const [leaderId, setLeaderId] = useState(control?.leader_minister_id ?? '')
    useEffect(() => setLeaderId(control?.leader_minister_id ?? ''), [control?.leader_minister_id])
    const eventAssignments = assignments.filter(item => item.event_date === eventDate && item.event_type === eventType)
    const assignedIds = new Set(eventAssignments.map(item => item.minister_id).filter((id): id is string => Boolean(id)))
    const leaders = ministers.filter(minister => assignedIds.has(minister.id))
    const cancelled = control?.status === 'cancelled'

    if (!onSave) {
        return control?.leader?.name ? <p className="mt-1 text-[11px] text-muted-foreground">Responsável: {control.leader.name}</p> : null
    }
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1.5" onClick={event => event.stopPropagation()}>
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="sr-only">Líder do evento de {formatDate(eventDate)}</span>
                <select
                    value={leaderId}
                    disabled={saving || cancelled}
                    onChange={async event => {
                        const nextId = event.target.value
                        setLeaderId(nextId)
                        try {
                            await onSave({ eventDate, eventType, leaderMinisterId: nextId || null })
                        } catch {
                            setLeaderId(control?.leader_minister_id ?? '')
                        }
                    }}
                    className="h-7 min-w-28 max-w-40 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground"
                >
                    <option value="">Sem líder</option>
                    {leaders.map(minister => <option key={minister.id} value={minister.id}>{minister.name}</option>)}
                </select>
            </label>
            {isPublished && (
                <Button
                    type="button" size="sm" variant={cancelled ? 'outline' : 'destructive'}
                    className="h-7 px-2 text-[10px]" disabled={saving}
                    onClick={() => void onSave({ eventDate, eventType, action: cancelled ? 'reactivate' : 'cancel' })}
                >
                    {saving ? 'Salvando…' : cancelled ? 'Reativar' : 'Cancelar evento'}
                </Button>
            )}
            {cancelled && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">Cancelado</span>}
        </div>
    )
}

function RehearsalEditor({
    eventDate,
    eventType,
    rehearsal,
    canEdit,
    status = 'ready',
    onSave,
}: {
    eventDate: string
    eventType: 'thursday' | 'sunday'
    rehearsal?: ScheduleRehearsal
    canEdit: boolean | ((eventDate: string, eventType: 'thursday' | 'sunday') => boolean)
    status?: 'ready' | 'loading' | 'error'
    onSave?: (payload: {
        eventDate: string
        eventType: 'thursday' | 'sunday'
        rehearsalDate: string | null
        rehearsalTime: string | null
        rehearsalPlace: string | null
    }) => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const isMobile = useIsMobile()

    // helpers: convert between storage format (YYYY-MM-DD) and display format (DD/MM/AAAA)
    const toDisplay = (iso: string) => {
        if (!iso) return ''
        const [y, m, d] = iso.split('-')
        return `${d}/${m}/${y}`
    }
    const toISO = (display: string) => {
        if (!display) return null
        const [d, m, y] = display.split('/')
        if (!d || !m || !y || y.length !== 4) return null
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }

    const [rehearsalDate, setRehearsalDate] = useState(() => toDisplay(rehearsal?.rehearsal_date ?? ''))
    const [rehearsalTime, setRehearsalTime] = useState(rehearsal?.rehearsal_time?.slice(0, 5) ?? '')
    const [rehearsalPlace, setRehearsalPlace] = useState(rehearsal?.rehearsal_place ?? '')

    useEffect(() => {
        setRehearsalDate(toDisplay(rehearsal?.rehearsal_date ?? ''))
        setRehearsalTime(rehearsal?.rehearsal_time?.slice(0, 5) ?? '')
        setRehearsalPlace(rehearsal?.rehearsal_place ?? '')
    }, [rehearsal?.rehearsal_date, rehearsal?.rehearsal_place, rehearsal?.rehearsal_time])

    const handleSave = async () => {
        if (!onSave) return
        setSaving(true)
        try {
            await onSave({
                eventDate,
                eventType,
                rehearsalDate: toISO(rehearsalDate),
                rehearsalTime: rehearsalTime || null,
                rehearsalPlace: rehearsalPlace.trim() || null,
            })
            setOpen(false)
        } finally {
            setSaving(false)
        }
    }

    const rehearsalInfo = rehearsalSummary(rehearsal)
    const hasRehearsal = rehearsal && (rehearsal.rehearsal_date || rehearsal.rehearsal_time || rehearsal.rehearsal_place)
    const canEditThisRehearsal = typeof canEdit === 'function' ? canEdit(eventDate, eventType) : canEdit

    const formContent = (
        <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-date">Data do ensaio (DD/MM/AAAA)</Label>
                <Input
                    id="rehearsal-date"
                    type="text"
                    inputMode="numeric"
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                    value={rehearsalDate}
                    onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
                        let masked = digits
                        if (digits.length > 4) masked = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
                        else if (digits.length > 2) masked = `${digits.slice(0, 2)}/${digits.slice(2)}`
                        setRehearsalDate(masked)
                    }}
                    disabled={saving}
                />
            </div>
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-time">Horário</Label>
                <Input
                    id="rehearsal-time"
                    type="text"
                    inputMode="numeric"
                    placeholder="HH:MM"
                    maxLength={5}
                    value={rehearsalTime}
                    onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                        const masked = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
                        setRehearsalTime(masked)
                    }}
                    disabled={saving}
                />
            </div>
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-place">Local</Label>
                <Input
                    className="w-full min-w-0 max-w-full"
                    id="rehearsal-place"
                    type="text"
                    placeholder="Ex: Igreja…"
                    value={rehearsalPlace}
                    onChange={(e) => setRehearsalPlace(e.target.value)}
                    disabled={saving}
                />
            </div>
        </div>
    )

    const formActions = (
        <>
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={saving} onClick={() => setOpen(false)}>
                Cancelar
            </Button>
            <Button type="button" className="w-full sm:w-auto" disabled={saving} onClick={handleSave}>
                {saving ? 'Salvando…' : 'Salvar ensaio'}
            </Button>
        </>
    )

    if (status !== 'ready') {
        return <p className="mt-1 text-[11px] text-muted-foreground">{status === 'loading' ? 'Carregando ensaio...' : 'Informações de ensaio indisponíveis'}</p>
    }

    return (
        <div className="mt-1">
            {/* Resumo visível quando há ensaio */}
            {hasRehearsal && (
                <p className="mb-1 text-[11px] text-muted-foreground">{rehearsalInfo}</p>
            )}

            {canEditThisRehearsal ? (
                <>
                    {isMobile ? (
                        <>
                            <Button
                                size="sm"
                                variant={hasRehearsal ? 'outline' : 'secondary'}
                                className="mb-4 h-7 w-full text-xs"
                                onClick={() => setOpen(true)}
                            >
                                {hasRehearsal ? 'Editar ensaio' : '+ Adicionar ensaio'}
                            </Button>
                            <Sheet open={open} onOpenChange={setOpen}>
                                <SheetContent side="bottom" className="rounded-t-xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                                    <SheetHeader>
                                        <SheetTitle>Ensaio — {formatDate(eventDate)}</SheetTitle>
                                    </SheetHeader>
                                    {formContent}
                                    <SheetFooter className="mt-4">{formActions}</SheetFooter>
                                </SheetContent>
                            </Sheet>
                        </>
                    ) : (
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]">
                                    {hasRehearsal ? 'Editar ensaio' : '+ Adicionar ensaio'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 space-y-3 p-4">
                                <p className="text-xs font-semibold text-foreground">Ensaio — {formatDate(eventDate)}</p>
                                {formContent}
                                <div className="flex justify-end gap-2">{formActions}</div>
                            </PopoverContent>
                        </Popover>
                    )}
                </>
            ) : (
                !hasRehearsal && (
                    <p className="text-[11px] italic text-muted-foreground/60">Ensaio não informado</p>
                )
            )}
        </div>
    )
}

function CellEditor({
    assignment,
    saving,
    onSave,
    ministerRoleFilter,
}: {
    assignment: ScheduleAssignment
    saving: boolean
    onSave: (payload: SavePayload) => Promise<void>
    ministerRoleFilter?: 'midia'
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [options, setOptions] = useState<MinisterOption[]>([])

    useEffect(() => {
        if (!open) {
            return
        }

        const controller = new AbortController()
        const timeout = setTimeout(async () => {
            try {
                setLoading(true)
                const roleParam = ministerRoleFilter ? `&role=${ministerRoleFilter}` : ''
                const response = await selectedChurchFetch(
                    `/api/ministers/search?query=${encodeURIComponent(query)}&limit=25${roleParam}`,
                    { signal: controller.signal }
                )

                const body = await response.json()
                if (!response.ok) {
                    throw new Error(body.error || 'Erro ao buscar ministros')
                }

                setOptions(body.ministers ?? [])
            } catch {
                setOptions([])
            } finally {
                setLoading(false)
            }
        }, 220)

        return () => {
            clearTimeout(timeout)
            controller.abort()
        }
    }, [ministerRoleFilter, open, query])

    const handlePick = async (minister: MinisterOption | null) => {
        await onSave({
            id: assignment.id,
            quarter_id: assignment.quarter_id,
            role_id: assignment.role_id,
            event_date: assignment.event_date,
            event_type: assignment.event_type,
            minister_id: minister?.id ?? null,
            minister_name: minister?.name ?? null,
            minister_avatar_url: minister?.avatar_url ?? null,
            is_trainee: minister ? assignment.is_trainee : false,
        })
        setOpen(false)
    }

    const handleTraineeChange = async (checked: boolean) => {
        if (!assignment.minister_id) return

        await onSave({
            id: assignment.id,
            quarter_id: assignment.quarter_id,
            role_id: assignment.role_id,
            event_date: assignment.event_date,
            event_type: assignment.event_type,
            minister_id: assignment.minister_id,
            minister_name: assignment.minister?.name ?? null,
            minister_avatar_url: assignment.minister?.avatar_url ?? null,
            is_trainee: checked,
        })
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={[
                        'h-9 w-full justify-between text-left text-xs',
                        assignment.minister_id
                            ? 'border-border text-foreground'
                            : 'border-dashed border-amber-400/70 text-muted-foreground',
                    ].join(' ')}
                    disabled={saving}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {assignment.minister && <UserAvatar name={assignment.minister.name} avatarUrl={assignment.minister.avatar_url} className="h-5 w-5 text-2xl" />}
                        <span className="truncate">{assignment.minister?.name ?? (ministerRoleFilter === 'midia' ? 'Selecionar mídia' : 'Selecionar ministro')}</span>
                    </span>
                    {assignment.minister_id && assignment.is_trainee && (
                        <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Aprendiz
                        </span>
                    )}
                    <span className="ml-2 shrink-0">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-80 p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder={ministerRoleFilter === 'midia' ? 'Buscar mídia por nome' : 'Buscar ministro por nome'}
                    />
                    <CommandList>
                        {loading && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Buscando...
                            </div>
                        )}
                        <CommandEmpty>{ministerRoleFilter === 'midia' ? 'Nenhum usuário de mídia encontrado' : 'Nenhum ministro encontrado'}</CommandEmpty>
                        <CommandGroup heading="Atribuição">
                            <CommandItem value="none" onSelect={() => handlePick(null)}>
                                <Check className={assignment.minister_id ? 'opacity-0' : 'opacity-100'} />
                                Limpar célula
                            </CommandItem>
                            {options.map((option) => (
                                <CommandItem key={option.id} value={option.id} onSelect={() => handlePick(option)}>
                                    <Check className={assignment.minister_id === option.id ? 'opacity-100' : 'opacity-0'} />
                                    <UserAvatar name={option.name} avatarUrl={option.avatar_url} className="h-7 w-7 text-3xl" />
                                    <div className="min-w-0">
                                        <p className="truncate">{option.name}</p>
                                        {option.email && (
                                            <p className="truncate text-[11px] text-muted-foreground">{option.email}</p>
                                        )}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>

                <div className="border-t px-3 py-2">
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Aprendiz neste evento</span>
                        <Checkbox
                            checked={assignment.is_trainee}
                            onCheckedChange={(checked) => handleTraineeChange(Boolean(checked))}
                            disabled={!assignment.minister_id || saving}
                        />
                    </label>
                </div>
            </PopoverContent>
        </Popover>
    )
}

export function ScheduleGrid({
    roles,
    dates,
    eventType,
    assignments,
    savingKeys = {},
    onSaveAssignment,
    readOnly = false,
    highlightedMinisterId = null,
    rehearsalByDate = {},
    rehearsalStatus = 'ready',
    canEditRehearsal = false,
    onSaveRehearsal,
    eventControls = [],
    activeMinisters = [],
    isPublished = false,
    savingEventKeys = {},
    onSaveEventControl,
}: ScheduleGridProps) {
    const cancelledEventKeys = useMemo(() => new Set(eventControls
        .filter(control => control.status === 'cancelled')
        .map(control => `${control.event_date}_${control.event_type}`)), [eventControls])
    const assignmentMap = useMemo(() => {
        const map = new Map<string, ScheduleAssignment>()
        for (const item of assignments) {
            if (item.event_type !== eventType) continue
            map.set(toCellKey(item.role_id, item.event_date), item)
        }
        return map
    }, [assignments, eventType])

    function ministerRoleFilterFor(role: ScheduleRole) {
        return role.category === 'midia' ? ('midia' as const) : undefined
    }

    function renderCell(assignment: ScheduleAssignment | undefined, cellKey: string, role: ScheduleRole) {
        if (!assignment) {
            return (
                <div className="flex h-8 items-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-2 text-xs text-muted-foreground">
                    Vazio
                </div>
            )
        }

        const eventCancelled = cancelledEventKeys.has(`${assignment.event_date}_${assignment.event_type}`)
        if (readOnly || eventCancelled) {
            return (
                <div
                    className={[
                        'flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs',
                        assignment.minister_id
                            ? assignment.minister_id === highlightedMinisterId
                                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                                : 'border-border bg-background text-foreground'
                            : 'border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground',
                    ].join(' ')}
                >
                    {assignment.minister && <UserAvatar name={assignment.minister.name} avatarUrl={assignment.minister.avatar_url} className="h-5 w-5 text-2xl" />}
                    <span className="truncate">{assignment.minister?.name ?? 'Vazio'}</span>
                    {assignment.minister_id && assignment.is_trainee && (
                        <span className="ml-1.5 shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                            Aprendiz
                        </span>
                    )}
                    {assignment.minister_id === highlightedMinisterId && highlightedMinisterId && (
                        <span className="ml-auto shrink-0 pl-1 text-[10px] text-primary">você</span>
                    )}
                </div>
            )
        }

        return (
            <div className="space-y-1">
                {onSaveAssignment ? (
                    <CellEditor
                        assignment={assignment}
                        saving={Boolean(savingKeys[cellKey] || savingKeys[assignment.id])}
                        onSave={onSaveAssignment}
                        ministerRoleFilter={ministerRoleFilterFor(role)}
                    />
                ) : (
                    <div className="flex h-8 items-center rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                        Seleção indisponível
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="rounded-xl bg-card sm:border sm:border-border">
            {/* ── Desktop: horizontal table ─────────────────────────── */}
            <div className="hidden overflow-x-auto sm:block">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="sticky left-0 z-10 min-w-52 bg-card">Função</TableHead>
                            {dates.map((date) => (
                                <TableHead key={date} className="min-w-44">
                                    <div>
                                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                                            <p className="text-xs sm:text-sm">{formatDate(date)}</p>
                                            <span className="inline-flex rounded-md border border-border bg-muted px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
                                                {formatWeekTag(date)}
                                            </span>
                                        </div>
                                        <RehearsalEditor
                                            eventDate={date}
                                            eventType={eventType}
                                            rehearsal={rehearsalByDate[`${date}_${eventType}`]}
                                            canEdit={canEditRehearsal}
                                            status={rehearsalStatus}
                                            onSave={onSaveRehearsal}
                                        />
                                        <EventControlEditor
                                            eventDate={date} eventType={eventType} assignments={assignments}
                                            controls={eventControls} ministers={activeMinisters} isPublished={isPublished}
                                            saving={Boolean(savingEventKeys[`${date}_${eventType}`])} onSave={onSaveEventControl}
                                        />
                                    </div>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>

                    <TableBody>
                        {roles.map((role) => (
                            <TableRow key={role.id}>
                                <TableCell className="sticky left-0 z-10 bg-card">
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{role.name}</p>
                                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{role.category}</p>
                                    </div>
                                </TableCell>

                                {dates.map((date) => {
                                    const cellKey = toCellKey(role.id, date)
                                    const assignment = assignmentMap.get(cellKey)

                                    if (!assignment) {
                                        return (
                                            <TableCell key={cellKey}>
                                                <div className="h-9 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20" />
                                            </TableCell>
                                        )
                                    }

                                    return (
                                        <TableCell key={cellKey}>
                                            {renderCell(assignment, cellKey, role)}
                                        </TableCell>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* ── Mobile: card per date ─────────────────────────────── */}
            <div className="space-y-3 p-3 sm:hidden bg-background">
                {dates.map((date) => (
                    <div key={date} className="rounded-xl border border-[var(--table-border)] bg-[var(--table-grid)] p-4 shadow-sm">
                        {/* Date header */}
                        <div className="mb-3 flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-foreground">{formatDate(date)}</p>
                            <span className="inline-flex rounded-md border border-border bg-muted px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
                                {formatWeekTag(date)}
                            </span>
                        </div>
                        <RehearsalEditor
                            eventDate={date}
                            eventType={eventType}
                            rehearsal={rehearsalByDate[`${date}_${eventType}`]}
                            canEdit={canEditRehearsal}
                            status={rehearsalStatus}
                            onSave={onSaveRehearsal}
                        />
                        <EventControlEditor
                            eventDate={date} eventType={eventType} assignments={assignments}
                            controls={eventControls} ministers={activeMinisters} isPublished={isPublished}
                            saving={Boolean(savingEventKeys[`${date}_${eventType}`])} onSave={onSaveEventControl}
                        />

                        {/* Role rows */}
                        <div className="space-y-2">
                            {roles.map((role) => {
                                const cellKey = toCellKey(role.id, date)
                                const assignment = assignmentMap.get(cellKey)

                                return (
                                    <div key={role.id} className="flex items-start gap-3">
                                        <div className="w-28 shrink-0 pt-1.5">
                                            <p className="text-xs font-medium leading-tight text-foreground">{role.name}</p>
                                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{role.category}</p>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            {renderCell(assignment, cellKey, role)}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
