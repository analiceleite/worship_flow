'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, getISOWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export interface ScheduleRole {
    id: string
    name: string
    category: 'ministro' | 'vocal' | 'instrumento'
    display_order: number
}

export interface AssignmentMinister {
    id: string
    name: string
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

interface MinisterOption {
    id: string
    name: string
    email: string | null
}

interface SavePayload {
    id: string
    quarter_id: string
    role_id: string
    event_date: string
    event_type: 'thursday' | 'sunday'
    minister_id: string | null
    minister_name: string | null
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
    canEditRehearsal?: boolean
    onSaveRehearsal?: (payload: {
        eventDate: string
        eventType: 'thursday' | 'sunday'
        rehearsalDate: string | null
        rehearsalTime: string | null
        rehearsalPlace: string | null
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

function RehearsalEditor({
    eventDate,
    eventType,
    rehearsal,
    canEdit,
    onSave,
}: {
    eventDate: string
    eventType: 'thursday' | 'sunday'
    rehearsal?: ScheduleRehearsal
    canEdit: boolean
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
    const [rehearsalDate, setRehearsalDate] = useState(rehearsal?.rehearsal_date ?? '')
    const [rehearsalTime, setRehearsalTime] = useState(rehearsal?.rehearsal_time?.slice(0, 5) ?? '')
    const [rehearsalPlace, setRehearsalPlace] = useState(rehearsal?.rehearsal_place ?? '')

    useEffect(() => {
        setRehearsalDate(rehearsal?.rehearsal_date ?? '')
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
                rehearsalDate: rehearsalDate || null,
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

    const formContent = (
        <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-date">Data do ensaio</Label>
                <Input
                    className="w-full min-w-0"
                    id="rehearsal-date"
                    type="date"
                    value={rehearsalDate}
                    onChange={(e) => setRehearsalDate(e.target.value)}
                    disabled={saving}
                />
            </div>
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-time">Horário</Label>
                <Input
                    className="w-full min-w-0"
                    id="rehearsal-time"
                    type="time"
                    value={rehearsalTime}
                    onChange={(e) => setRehearsalTime(e.target.value)}
                    disabled={saving}
                />
            </div>
            <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rehearsal-place">Local</Label>
                <Input
                    className="w-full min-w-0"
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

    return (
        <div className="mt-1">
            {/* Resumo visível quando há ensaio */}
            {hasRehearsal && (
                <p className="mb-1 text-[11px] text-muted-foreground">{rehearsalInfo}</p>
            )}

            {canEdit ? (
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
                            <Dialog open={open} onOpenChange={setOpen}>
                                <DialogContent className="h-[100dvh] w-screen max-w-none rounded-none border-0 overflow-x-hidden overflow-y-auto p-4 pt-8 flex flex-col">
                                    <DialogHeader>
                                        <DialogTitle>Ensaio — {formatDate(eventDate)}</DialogTitle>
                                    </DialogHeader>
                                    {formContent}
                                    <DialogFooter className="mt-4 flex-col-reverse gap-2">{formActions}</DialogFooter>
                                </DialogContent>
                            </Dialog>
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
}: {
    assignment: ScheduleAssignment
    saving: boolean
    onSave: (payload: SavePayload) => Promise<void>
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
                const response = await fetch(
                    `/api/ministers/search?query=${encodeURIComponent(query)}&limit=25`,
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
    }, [open, query])

    const handlePick = async (minister: MinisterOption | null) => {
        await onSave({
            id: assignment.id,
            quarter_id: assignment.quarter_id,
            role_id: assignment.role_id,
            event_date: assignment.event_date,
            event_type: assignment.event_type,
            minister_id: minister?.id ?? null,
            minister_name: minister?.name ?? null,
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
                    <span className="truncate">
                        {assignment.minister?.name ?? 'Selecionar ministro'}
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
                        placeholder="Buscar ministro por nome"
                    />
                    <CommandList>
                        {loading && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Buscando...
                            </div>
                        )}
                        <CommandEmpty>Nenhum ministro encontrado</CommandEmpty>
                        <CommandGroup heading="Atribuição">
                            <CommandItem value="none" onSelect={() => handlePick(null)}>
                                <Check className={assignment.minister_id ? 'opacity-0' : 'opacity-100'} />
                                Limpar célula
                            </CommandItem>
                            {options.map((option) => (
                                <CommandItem key={option.id} value={option.id} onSelect={() => handlePick(option)}>
                                    <Check className={assignment.minister_id === option.id ? 'opacity-100' : 'opacity-0'} />
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
                        <span>Em treinamento</span>
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
    canEditRehearsal = false,
    onSaveRehearsal,
}: ScheduleGridProps) {
    const assignmentMap = useMemo(() => {
        const map = new Map<string, ScheduleAssignment>()
        for (const item of assignments) {
            if (item.event_type !== eventType) continue
            map.set(toCellKey(item.role_id, item.event_date), item)
        }
        return map
    }, [assignments, eventType])

    function renderCell(assignment: ScheduleAssignment | undefined, cellKey: string) {
        if (!assignment) {
            return (
                <div className="flex h-8 items-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-2 text-xs text-muted-foreground">
                    Vazio
                </div>
            )
        }

        if (readOnly) {
            return (
                <div
                    className={[
                        'flex h-8 items-center rounded-md border px-2 text-xs',
                        assignment.minister_id
                            ? assignment.minister_id === highlightedMinisterId
                                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                                : 'border-border bg-background text-foreground'
                            : 'border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground',
                    ].join(' ')}
                >
                    <span className="truncate">{assignment.minister?.name ?? 'Vazio'}</span>
                    {assignment.minister_id && assignment.is_trainee && (
                        <span className="ml-1.5 shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                            aprendiz
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
                                            onSave={onSaveRehearsal}
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
                                            {readOnly ? (
                                                <div
                                                    className={[
                                                        'flex h-9 items-center rounded-md border px-2 text-xs',
                                                        assignment.minister_id
                                                            ? assignment.minister_id === highlightedMinisterId
                                                                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                                                                : 'border-border bg-background text-foreground'
                                                            : 'border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground',
                                                    ].join(' ')}
                                                >
                                                    <span className="truncate">{assignment.minister?.name ?? 'Vazio'}</span>
                                                    {assignment.minister_id && assignment.is_trainee && (
                                                        <span className="ml-1.5 shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                                            aprendiz
                                                        </span>
                                                    )}
                                                    {assignment.minister_id === highlightedMinisterId && highlightedMinisterId && (
                                                        <span className="ml-auto shrink-0 pl-1 text-[10px] text-primary">você</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    {onSaveAssignment ? (
                                                        <CellEditor
                                                            assignment={assignment}
                                                            saving={Boolean(savingKeys[assignment.id])}
                                                            onSave={onSaveAssignment}
                                                        />
                                                    ) : (
                                                        <div className="flex h-9 items-center rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                                                            Seleção indisponível
                                                        </div>
                                                    )}
                                                </div>
                                            )}
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
                            onSave={onSaveRehearsal}
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
                                            {renderCell(assignment, cellKey)}
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
