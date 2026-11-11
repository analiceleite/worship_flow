'use client'

import { PAGE_WIDTH } from '@/lib/page-layout'
import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ROUTES } from '@/lib/routes'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    AlertCircle,
    BarChart3,
    CalendarClock,
    ChevronDown,
    RefreshCcw,
    ShieldAlert,
    Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { selectedChurchFetch } from '@/lib/auth/client-context'

interface BimesterSummary {
    id: string
    name: string
    start_date: string
    end_date: string
    is_published: boolean
    created_at: string
}

interface AnalyticsSummary {
    total_slots: number
    filled_slots: number
    empty_slots: number
    coverage_percent: number
    trainees: number
    active_ministers: number
    average_assignments_per_minister: number
    overloaded_ministers: number
    underutilized_ministers: number
}

interface AnalyticsRole {
    role_id: string
    role_name: string
    category: 'ministro' | 'vocal' | 'instrumento' | 'midia'
    total: number
    filled: number
    empty: number
    trainees: number
    coverage_percent: number
}

interface AnalyticsMinister {
    minister_id: string
    name: string
    instrument: string
    role: 'admin' | 'minister' | 'midia'
    total_assignments: number
    sunday_assignments: number
    thursday_assignments: number
    trainee_assignments: number
    overload_delta_percent: number
    is_overloaded: boolean
    is_underutilized: boolean
}

type EventType = 'thursday' | 'sunday'

interface AnalyticsEvent {
    event_date: string
    event_type: EventType
    total_slots: number
    filled_slots: number
    empty_slots: number
    coverage_percent: number
    missing_roles: string[]
}

interface AnalyticsResponse {
    quarter: BimesterSummary | null
    bimester_label?: string
    summary: AnalyticsSummary
    by_role: AnalyticsRole[]
    by_minister: AnalyticsMinister[]
    by_event: AnalyticsEvent[]
    alerts: {
        overloaded_ministers: Array<{
            minister_id: string
            name: string
            total_assignments: number
            overload_delta_percent: number
        }>
        events_with_gaps: AnalyticsEvent[]
    }
    generated_at: string
}

// Metas e limites de cobertura (SPEC WF-36 §6.4): verde a partir de 80%, alerta abaixo de 60%.
const COVERAGE_TARGET = 80
const COVERAGE_ALERT = 60
// Limite de sobrecarga: 30% acima da média (mesma regra da API, SPEC §5.1).
const OVERLOAD_FACTOR = 1.3
const ATTENTION_INITIAL = 3

function formatDateBr(value: string) {
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

function formatEventLabel(eventType: AnalyticsEvent['event_type']) {
    return eventType === 'sunday' ? 'Domingo' : 'Quinta'
}

function formatAverage(value: number) {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function plural(count: number, one: string, many: string) {
    return `${count} ${count === 1 ? one : many}`
}

// Data de hoje no fuso do navegador, no formato YYYY-MM-DD (mesmo formato de event_date).
function todayIso() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

function getInitials(name: string) {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
}

// Link para a escala (builder) do bimestre; pode abrir um evento ou filtrar por ministro.
function buildScheduleHref(
    quarterId: string,
    target?: { event?: { event_date: string; event_type: EventType }; ministerId?: string },
) {
    if (!quarterId) return ROUTES.SCHEDULE_ADMIN_BUILDER
    const params = new URLSearchParams({ quarter: quarterId })
    if (target?.event) params.set('event', `${target.event.event_date}_${target.event.event_type}`)
    if (target?.ministerId) params.set('minister', target.ministerId)
    return `${ROUTES.SCHEDULE_ADMIN_BUILDER}?${params.toString()}`
}

// ─── Lista com "Ver mais" ────────────────────────────────────────────────────

function ExpandableList<T>({
    items,
    initial,
    getKey,
    renderItem,
    className,
    label,
}: {
    items: T[]
    initial: number
    getKey: (item: T) => string
    renderItem: (item: T) => ReactNode
    className?: string
    label: string
}) {
    const [expanded, setExpanded] = useState(false)
    const visible = expanded ? items : items.slice(0, initial)
    const hiddenCount = items.length - visible.length

    return (
        <div className={cn('flex flex-col', className)}>
            {visible.map((item) => (
                <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
            ))}
            {items.length > initial && (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    className="mt-2 self-start min-h-11 px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
                >
                    {expanded ? `Ver menos ${label}` : `Ver mais ${label} (${hiddenCount})`}
                </button>
            )}
        </div>
    )
}

// ─── Seção recolhível ────────────────────────────────────────────────────────

function CollapsibleCard({
    id,
    title,
    icon,
    description,
    open,
    onToggle,
    children,
}: {
    id: string
    title: string
    icon: ReactNode
    description?: string
    open: boolean
    onToggle: () => void
    children: ReactNode
}) {
    const panelId = `${id}-panel`
    return (
        <Card className="py-4">
            <CardHeader className="pb-3">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={onToggle}
                    className="flex w-full min-h-11 items-start justify-between gap-2 text-left rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                    <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            {icon}
                            {title}
                        </span>
                        {description && (
                            <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                        )}
                    </span>
                    <ChevronDown
                        aria-hidden="true"
                        className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', { 'rotate-180': open })}
                    />
                </button>
            </CardHeader>
            <CardContent id={panelId} hidden={!open}>
                {children}
            </CardContent>
        </Card>
    )
}

// ─── Título de cartão ─────────────────────────────────────────────────────────

function CardTitleRow({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children?: ReactNode }) {
    return (
        <CardHeader className="pb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {icon}
                {title}
            </span>
            {description && <span className="block text-xs text-muted-foreground">{description}</span>}
            {children}
        </CardHeader>
    )
}

// ─── Resumo do topo ──────────────────────────────────────────────────────────

function SummaryLine({ text, href, linkLabel }: { text: string; href?: string; linkLabel?: string }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
            <p className="text-sm text-foreground">{text}</p>
            {href && linkLabel && (
                <Link href={href} className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-primary hover:underline">
                    {linkLabel}
                </Link>
            )}
        </div>
    )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
    label,
    value,
    sub,
    variant = 'default',
}: {
    label: string
    value: string | number
    sub: string
    variant?: 'default' | 'success' | 'danger'
}) {
    return (
        <div className="rounded-lg bg-muted p-4 flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
                className={cn('text-3xl font-medium leading-tight', {
                    'text-foreground': variant === 'default',
                    'text-green-700 dark:text-green-400': variant === 'success',
                    'text-destructive': variant === 'danger',
                })}
            >
                {value}
            </p>
            <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
    )
}

// ─── Cobertura por função ─────────────────────────────────────────────────────
// Vagas em aberto são esperadas (poucas pessoas para todas as funções): tom neutro, não de alerta.

function CoverageBar({ filled, total, label }: { filled: number; total: number; label: string }) {
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0
    const empty = total - filled
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-start gap-2">
                <span className="text-sm text-foreground break-words min-w-0">{label}</span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {filled}/{total}
                    {empty > 0 ? ` · ${empty} em aberto` : ''}
                </span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted" aria-hidden="true">
                <div className="bg-primary h-full transition-all duration-500" style={{ width: `${pct}%` }} />
                {empty > 0 && <div className="bg-muted-foreground/25 h-full transition-all duration-500" style={{ width: `${100 - pct}%` }} />}
            </div>
        </div>
    )
}

// ─── Carga por ministro ───────────────────────────────────────────────────────

function MinisterBar({
    assignments,
    max,
    avg,
    isOverloaded,
}: {
    assignments: number
    max: number
    avg: number
    isOverloaded: boolean
}) {
    const pct = max > 0 ? Math.round((assignments / max) * 100) : 0
    const avgPct = max > 0 ? Math.round((avg / max) * 100) : 0
    const thresholdPct = max > 0 ? Math.min(Math.round((avg * OVERLOAD_FACTOR / max) * 100), 100) : 0
    return (
        <div className="relative h-2 bg-muted rounded-full overflow-visible" aria-hidden="true">
            <div
                className={cn('h-full rounded-full absolute transition-all duration-500', {
                    'bg-destructive': isOverloaded,
                    'bg-blue-600 dark:bg-blue-400': !isOverloaded,
                })}
                style={{ width: `${pct}%` }}
            />
            <div
                className="absolute top-[-3px] w-0.5 h-[14px] bg-amber-500 rounded-sm z-10"
                style={{ left: `${avgPct}%` }}
            />
            {thresholdPct < 100 && (
                <div
                    className="absolute top-[-3px] w-0.5 h-[14px] bg-destructive rounded-sm z-10 opacity-70"
                    style={{ left: `${thresholdPct}%` }}
                />
            )}
        </div>
    )
}

// ─── Culto com vagas em aberto (informativo) ──────────────────────────────────

function GapCard({ event, quarterId }: { event: AnalyticsEvent; quarterId: string }) {
    return (
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground min-w-0 break-words">
                    {formatDateBr(event.event_date)} · {formatEventLabel(event.event_type)}
                </p>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {plural(event.empty_slots, 'vaga em aberto', 'vagas em aberto')}
                </span>
            </div>

            {event.missing_roles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {event.missing_roles.map((role) => (
                        <span
                            key={role}
                            className="inline-flex items-center rounded-md bg-background border border-border px-1.5 py-1 text-[11px] text-muted-foreground leading-none"
                        >
                            {role}
                        </span>
                    ))}
                </div>
            )}

            <Link
                href={buildScheduleHref(quarterId, { event })}
                className="mt-1 inline-flex items-center min-h-11 px-1 text-sm font-medium text-primary hover:underline"
            >
                Abrir escala do evento
            </Link>
        </div>
    )
}

// ─── Linha de culto (celular) ─────────────────────────────────────────────────

function EventRow({ event, quarterId }: { event: AnalyticsEvent; quarterId: string }) {
    const empty = event.empty_slots
    const pct = event.total_slots > 0 ? Math.round((event.filled_slots / event.total_slots) * 100) : 0

    return (
        <div className="flex flex-col gap-1.5 py-3 border-b border-border last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground leading-none">
                    {formatDateBr(event.event_date)} · {formatEventLabel(event.event_type)}
                </p>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {event.filled_slots}/{event.total_slots}
                </span>
            </div>

            <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums w-8 text-right">{pct}%</span>
            </div>

            {empty > 0 && (
                <>
                    <p className="text-xs text-muted-foreground break-words">
                        Em aberto: {event.missing_roles.join(' · ')}
                    </p>
                    <Link
                        href={buildScheduleHref(quarterId, { event })}
                        className="self-start inline-flex items-center min-h-11 px-1 text-sm font-medium text-primary hover:underline"
                    >
                        Abrir escala do evento
                    </Link>
                </>
            )}
        </div>
    )
}

// ─── Tabela de cultos (desktop) ───────────────────────────────────────────────

function EventsTable({ events, quarterId }: { events: AnalyticsEvent[]; quarterId: string }) {
    return (
        <div className="max-h-[560px] overflow-auto rounded-md border">
            <table className="w-full text-sm">
                <caption className="sr-only">Cultos do bimestre com preenchimento e funções em aberto</caption>
                <thead className="sticky top-0 bg-card z-10 text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                        <th scope="col" className="px-3 py-2 font-medium">Data</th>
                        <th scope="col" className="px-3 py-2 font-medium">Tipo</th>
                        <th scope="col" className="px-3 py-2 font-medium text-right">Preenchidas</th>
                        <th scope="col" className="px-3 py-2 font-medium">Funções em aberto</th>
                        <th scope="col" className="px-3 py-2"><span className="sr-only">Ação</span></th>
                    </tr>
                </thead>
                <tbody>
                    {events.map((event) => {
                        const key = `${event.event_date}_${event.event_type}`
                        return (
                            <tr key={key} className="border-b last:border-0 align-top">
                                <td className="px-3 py-2 whitespace-nowrap font-medium text-foreground">{formatDateBr(event.event_date)}</td>
                                <td className="px-3 py-2 text-muted-foreground">{formatEventLabel(event.event_type)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                    {event.filled_slots}/{event.total_slots}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground break-words">
                                    {event.missing_roles.length ? event.missing_roles.join(' · ') : '—'}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <Link
                                        href={buildScheduleHref(quarterId, { event })}
                                        className="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline whitespace-nowrap"
                                    >
                                        Abrir
                                        <span className="sr-only"> escala de {formatDateBr(event.event_date)}</span>
                                    </Link>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ScheduleAdminDashboardPage() {
    const [loading, setLoading] = useState(true)
    const [loadingBimesters, setLoadingBimesters] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [eventFilter, setEventFilter] = useState<'all' | 'sunday' | 'thursday'>('all')
    const [isDesktop, setIsDesktop] = useState(false)
    // null = segue o padrão da largura da tela até a pessoa alternar a seção.
    const [coverageOpen, setCoverageOpen] = useState<boolean | null>(null)
    const [showPastGaps, setShowPastGaps] = useState(false)

    const [bimesters, setBimesters] = useState<BimesterSummary[]>([])
    const [selectedBimesterId, setSelectedBimesterId] = useState<string>('')
    const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)

    useEffect(() => {
        const media = window.matchMedia('(min-width: 1024px)')
        const update = () => setIsDesktop(media.matches)
        update()
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])

    const loadBimesters = useCallback(async () => {
        try {
            const response = await selectedChurchFetch('/api/schedule/quarters')
            const body = await response.json()
            if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os bimestres')
            const loaded = (body.quarters ?? []) as BimesterSummary[]
            setBimesters(loaded)
            if (!loaded.length) { setSelectedBimesterId(''); return }
            const published = loaded.find((q) => q.is_published)?.id
            setSelectedBimesterId((current) => current || published || loaded[0].id)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao carregar bimestres')
        } finally {
            setLoadingBimesters(false)
        }
    }, [])

    const loadAnalytics = useCallback(async (bimesterId?: string) => {
        try {
            setError(null)
            const suffix = bimesterId ? `?quarter_id=${bimesterId}` : ''
            const response = await selectedChurchFetch(`/api/schedule/admin/analytics${suffix}`)
            const body = (await response.json()) as AnalyticsResponse & { error?: string }
            if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os indicadores')
            setAnalytics(body)
            if (body.quarter?.id && !bimesterId) setSelectedBimesterId(body.quarter.id)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao carregar indicadores')
            setAnalytics(null)
        }
    }, [])

    useEffect(() => { void loadBimesters() }, [loadBimesters])

    useEffect(() => {
        const run = async () => {
            if (loadingBimesters) return
            setLoading(true)
            await loadAnalytics(selectedBimesterId || undefined)
            setLoading(false)
        }
        void run()
    }, [loadingBimesters, loadAnalytics, selectedBimesterId])

    const maxAssignments = useMemo(
        () => Math.max(...(analytics?.by_minister ?? []).map((m) => m.total_assignments), 1),
        [analytics?.by_minister],
    )

    const avg = analytics?.summary.average_assignments_per_minister ?? 0
    const quarterId = analytics?.quarter?.id ?? ''
    const overloadedMinisters = analytics?.alerts.overloaded_ministers ?? []
    const byMinister = analytics?.by_minister ?? []
    const idleMinisters = byMinister.filter((m) => m.total_assignments === 0)

    const filteredEvents = useMemo(() => {
        const events = analytics?.by_event ?? []
        if (eventFilter === 'sunday') return events.filter((e) => e.event_type === 'sunday')
        if (eventFilter === 'thursday') return events.filter((e) => e.event_type === 'thursday')
        return events
    }, [analytics?.by_event, eventFilter])

    // Lacunas separadas por tempo: próximos cultos na tela principal; passados em bloco recolhido.
    const today = todayIso()
    const allGaps = analytics?.alerts.events_with_gaps ?? []
    const upcomingGaps = allGaps.filter((e) => e.event_date >= today)
    const pastGaps = allGaps.filter((e) => e.event_date < today)
    const upcomingEmptySlots = upcomingGaps.reduce((sum, e) => sum + e.empty_slots, 0)

    const coverageIsOpen = coverageOpen ?? isDesktop

    const summaryText = (() => {
        if (!analytics) return ''
        if (upcomingGaps.length === 0 && overloadedMinisters.length === 0) {
            return `Nenhuma sobrecarga e nenhuma vaga em aberto nos próximos cultos · cobertura de ${analytics.summary.coverage_percent}%`
        }
        const parts: string[] = []
        if (overloadedMinisters.length) {
            parts.push(plural(overloadedMinisters.length, 'ministro sobrecarregado', 'ministros sobrecarregados'))
        }
        if (upcomingGaps.length) {
            parts.push(`${plural(upcomingEmptySlots, 'vaga em aberto', 'vagas em aberto')} em ${plural(upcomingGaps.length, 'culto futuro', 'cultos futuros')}`)
        }
        parts.push(`cobertura de ${analytics.summary.coverage_percent}%`)
        return parts.join(' · ')
    })()

    const summaryAction = overloadedMinisters[0]
        ? { href: buildScheduleHref(quarterId, { ministerId: overloadedMinisters[0].minister_id }), label: 'Ver primeiro alerta' }
        : upcomingGaps[0]
            ? { href: buildScheduleHref(quarterId, { event: upcomingGaps[0] }), label: 'Ver próximo culto com vagas' }
            : null

    return (
        <div className="min-h-screen bg-background">

            <main className={`${PAGE_WIDTH} py-6 overflow-x-hidden`}>

                {/* ── Top bar ── */}
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-foreground">Dashboard de Alocação</h1>
                        <p className="text-sm text-muted-foreground">
                            Cobertura, sobrecarga e lacunas do bimestre
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            value={selectedBimesterId}
                            onValueChange={setSelectedBimesterId}
                            disabled={loadingBimesters || bimesters.length === 0}
                        >
                            <SelectTrigger className="min-w-[220px]" aria-label="Selecionar bimestre">
                                <SelectValue placeholder={loadingBimesters ? 'Carregando…' : 'Selecionar bimestre'} />
                            </SelectTrigger>
                            <SelectContent>
                                {bimesters.map((q) => (
                                    <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                setRefreshing(true)
                                await loadAnalytics(selectedBimesterId || undefined)
                                setRefreshing(false)
                            }}
                            disabled={loading || refreshing}
                        >
                            <RefreshCcw className={cn('mr-2 h-3.5 w-3.5', { 'animate-spin': refreshing })} />
                            Atualizar
                        </Button>
                    </div>
                </div>

                {/* ── Error ── */}
                {error && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* ── Loading ── */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Spinner className="h-6 w-6" />
                    </div>

                ) : error && !analytics ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-sm font-medium">Não foi possível carregar os indicadores</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Isto é uma falha de carregamento, não ausência de dados.
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-4"
                                onClick={() => void loadAnalytics(selectedBimesterId || undefined)}
                            >
                                Tentar novamente
                            </Button>
                        </CardContent>
                    </Card>

                ) : !analytics?.quarter ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-sm font-medium">Nenhum bimestre disponível para análise</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Crie e publique um bimestre para visualizar os indicadores.
                            </p>
                        </CardContent>
                    </Card>

                ) : (
                    <div className="space-y-5">

                        {/* ── Faixa 1: contexto, resumo e indicadores ── */}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground break-words">{analytics.quarter.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {formatDateBr(analytics.quarter.start_date)} a {formatDateBr(analytics.quarter.end_date)}
                                </p>
                                {analytics.summary.total_slots === 0 && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Ainda não há alocações cadastradas neste bimestre.
                                    </p>
                                )}
                            </div>
                            <Badge variant={analytics.quarter.is_published ? 'default' : 'outline'}>
                                {analytics.quarter.is_published ? 'Publicado' : 'Rascunho'}
                            </Badge>
                        </div>

                        <SummaryLine text={summaryText} href={summaryAction?.href} linkLabel={summaryAction?.label} />

                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                            <KpiCard
                                label="Cobertura geral"
                                value={`${analytics.summary.coverage_percent}%`}
                                sub={`Meta ${COVERAGE_TARGET}% · ${analytics.summary.filled_slots}/${analytics.summary.total_slots} vagas`}
                                variant={analytics.summary.coverage_percent >= COVERAGE_TARGET ? 'success' : analytics.summary.coverage_percent < COVERAGE_ALERT ? 'danger' : 'default'}
                            />
                            <KpiCard
                                label="Vagas em aberto"
                                value={upcomingEmptySlots}
                                sub="Nos próximos cultos · esperado"
                            />
                            <KpiCard
                                label="Sobrecarregados"
                                value={analytics.summary.overloaded_ministers}
                                sub="30% acima da média"
                                variant={analytics.summary.overloaded_ministers > 0 ? 'danger' : 'success'}
                            />
                            <KpiCard
                                label="Subutilizados"
                                value={analytics.summary.underutilized_ministers}
                                sub="30% abaixo da média"
                            />
                        </div>

                        {/* ── Faixa 2: ações e equipe (alturas iguais no desktop) ── */}
                        <div className="grid gap-4 lg:grid-cols-2">

                            <Card className="py-4">
                                <CardTitleRow
                                    icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                                    title="Ações"
                                    description={`Sobrecarga a revisar e cultos futuros com vagas em aberto · média de ${formatAverage(avg)} alocações por ministro`}
                                />
                                <CardContent className="flex flex-col gap-6">
                                    <section aria-labelledby="overload-title" className="flex flex-col gap-2">
                                        <h2 id="overload-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            Sobrecarga
                                        </h2>
                                        {overloadedMinisters.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">Nenhum ministro acima de 30% da média.</p>
                                        ) : (
                                            <ExpandableList
                                                items={overloadedMinisters}
                                                initial={ATTENTION_INITIAL}
                                                getKey={(item) => item.minister_id}
                                                label="ministros"
                                                className="gap-2"
                                                renderItem={(item) => (
                                                    <div className="mb-2 rounded-lg bg-destructive/8 border border-destructive/20 px-3 py-2.5">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <p className="text-sm font-medium text-foreground min-w-0 break-words">{item.name}</p>
                                                            <span className="text-xs font-semibold text-destructive shrink-0 tabular-nums">
                                                                +{item.overload_delta_percent}%
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            {plural(item.total_assignments, 'alocação', 'alocações')} no bimestre
                                                        </p>
                                                        <Link
                                                            href={buildScheduleHref(quarterId, { ministerId: item.minister_id })}
                                                            className="mt-1 inline-flex items-center min-h-11 px-1 text-sm font-medium text-primary hover:underline"
                                                        >
                                                            Ver escalas deste ministro
                                                        </Link>
                                                    </div>
                                                )}
                                            />
                                        )}
                                    </section>

                                    <section aria-labelledby="gaps-title" className="flex flex-col gap-2">
                                        <h2 id="gaps-title" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                                            Cultos futuros com vagas em aberto
                                        </h2>
                                        {upcomingGaps.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">Todos os cultos futuros estão com as funções preenchidas.</p>
                                        ) : (
                                            <ExpandableList
                                                items={upcomingGaps}
                                                initial={ATTENTION_INITIAL}
                                                getKey={(event) => `${event.event_date}_${event.event_type}`}
                                                label="cultos"
                                                className="gap-2"
                                                renderItem={(event) => (
                                                    <div className="mb-2">
                                                        <GapCard event={event} quarterId={quarterId} />
                                                    </div>
                                                )}
                                            />
                                        )}

                                        {pastGaps.length > 0 && (
                                            <div className="mt-2 border-t pt-3">
                                                <button
                                                    type="button"
                                                    aria-expanded={showPastGaps}
                                                    onClick={() => setShowPastGaps((value) => !value)}
                                                    className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                                                >
                                                    Vagas em cultos passados ({pastGaps.length})
                                                    <ChevronDown
                                                        aria-hidden="true"
                                                        className={cn('h-4 w-4 shrink-0 transition-transform', { 'rotate-180': showPastGaps })}
                                                    />
                                                </button>
                                                {showPastGaps && (
                                                    <div className="mt-2 flex flex-col gap-2">
                                                        {pastGaps.map((event) => (
                                                            <GapCard key={`${event.event_date}_${event.event_type}`} event={event} quarterId={quarterId} />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </section>
                                </CardContent>
                            </Card>

                            <Card className="py-4">
                                <CardTitleRow
                                    icon={<Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                                    title="Equipe e carga"
                                    description={`${plural(analytics.summary.active_ministers, 'ministro ativo', 'ministros ativos')} · ${plural(analytics.summary.trainees, 'aprendiz', 'aprendizes')} no bimestre`}
                                >
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 dark:bg-blue-400 inline-block" />
                                            Normal
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-destructive inline-block" />
                                            Sobrecarregado
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-0.5 h-3 bg-amber-500 inline-block" />
                                            Média
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-0.5 h-3 bg-destructive opacity-70 inline-block" />
                                            Limite (+30%)
                                        </span>
                                    </div>
                                </CardTitleRow>
                                <CardContent className="flex flex-col gap-4">
                                    <ExpandableList
                                        items={byMinister.filter((m) => m.total_assignments > 0)}
                                        initial={10}
                                        getKey={(m) => m.minister_id}
                                        label="ministros"
                                        className="gap-3"
                                        renderItem={(m) => (
                                            <div className="flex flex-col gap-1.5 border-b border-border py-3 last:border-0">
                                                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                        <div
                                                            className={cn(
                                                                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                                                                m.is_overloaded
                                                                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                                                                    : 'bg-muted text-muted-foreground',
                                                            )}
                                                            aria-hidden="true"
                                                        >
                                                            {getInitials(m.name)}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <Link
                                                                href={buildScheduleHref(quarterId, { ministerId: m.minister_id })}
                                                                className="inline-flex min-h-11 items-center text-sm font-medium text-foreground hover:underline break-words"
                                                            >
                                                                {m.name}
                                                            </Link>
                                                            <p className="text-xs text-muted-foreground break-words">{m.instrument}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                        <Badge variant="outline" className="text-xs">
                                                            {plural(m.total_assignments, 'alocação', 'alocações')}
                                                        </Badge>
                                                        {m.is_overloaded && (
                                                            <Badge variant="destructive" className="text-xs">Sobrecarregado</Badge>
                                                        )}
                                                        {m.is_underutilized && (
                                                            <Badge variant="secondary" className="text-xs">Subutilizado</Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <MinisterBar
                                                    assignments={m.total_assignments}
                                                    max={maxAssignments}
                                                    avg={avg}
                                                    isOverloaded={m.is_overloaded}
                                                />
                                            </div>
                                        )}
                                    />

                                    {idleMinisters.length > 0 && (
                                        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                                            <p className="text-xs font-medium text-muted-foreground">
                                                Sem escala neste bimestre ({idleMinisters.length})
                                            </p>
                                            <p className="mt-1 text-sm text-foreground break-words">
                                                {idleMinisters.map((m) => m.name).join(' · ')}
                                            </p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* ── Faixa 3: cultos (tabela no desktop) e cobertura por função ── */}
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">

                            <Card className="py-4">
                                <CardTitleRow
                                    icon={<BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                                    title="Cultos do bimestre"
                                    description="Preenchimento de cada culto e funções ainda em aberto"
                                >
                                    <div role="tablist" aria-label="Filtrar cultos por tipo" className="flex gap-0 border-b border-border mt-3 -mb-1">
                                        {(['all', 'sunday', 'thursday'] as const).map((tab) => (
                                            <button
                                                key={tab}
                                                type="button"
                                                role="tab"
                                                aria-selected={eventFilter === tab}
                                                onClick={() => setEventFilter(tab)}
                                                className={cn(
                                                    'min-h-11 px-3 text-sm border-b-2 transition-colors',
                                                    eventFilter === tab
                                                        ? 'border-primary text-foreground font-medium'
                                                        : 'border-transparent text-muted-foreground hover:text-foreground',
                                                )}
                                            >
                                                {tab === 'all' ? 'Todos' : tab === 'sunday' ? 'Domingos' : 'Quintas'}
                                            </button>
                                        ))}
                                    </div>
                                </CardTitleRow>
                                <CardContent>
                                    {filteredEvents.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-2">Nenhum culto neste filtro.</p>
                                    ) : (
                                        <>
                                            <div className="hidden md:block">
                                                <EventsTable events={filteredEvents} quarterId={quarterId} />
                                            </div>
                                            <div className="md:hidden">
                                                <ExpandableList
                                                    items={filteredEvents}
                                                    initial={8}
                                                    getKey={(event) => `${event.event_date}_${event.event_type}`}
                                                    label="cultos"
                                                    renderItem={(event) => <EventRow event={event} quarterId={quarterId} />}
                                                />
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>

                            <CollapsibleCard
                                id="coverage"
                                title="Cobertura por Função"
                                description={`Preenchido vs. em aberto por função · meta ${COVERAGE_TARGET}%, alerta abaixo de ${COVERAGE_ALERT}%`}
                                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                                open={coverageIsOpen}
                                onToggle={() => setCoverageOpen(!coverageIsOpen)}
                            >
                                <div className="flex flex-col gap-3">
                                    {analytics.by_role.map((role) => (
                                        <CoverageBar
                                            key={role.role_id}
                                            label={role.role_name}
                                            filled={role.filled}
                                            total={role.total}
                                        />
                                    ))}
                                </div>
                            </CollapsibleCard>
                        </div>

                    </div>
                )}
            </main>
        </div>
    )
}
