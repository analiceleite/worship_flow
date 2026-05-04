'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/header'
import { ROUTES } from '@/lib/routes'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    RefreshCcw,
    ShieldAlert,
    UserRound,
    Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
    category: 'ministro' | 'vocal' | 'instrumento'
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

interface AnalyticsEvent {
    event_date: string
    event_type: 'thursday' | 'sunday'
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

function getInitials(name: string) {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
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

// ─── Horizontal stacked bar ───────────────────────────────────────────────────

function CoverageBar({ filled, total, label }: { filled: number; total: number; label: string }) {
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0
    const empty = total - filled
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
                <span className="text-sm text-foreground truncate pr-2">{label}</span>
                <span className="text-xs text-muted-foreground shrink-0">{filled}/{total}</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                <div
                    className="bg-green-600 dark:bg-green-500 h-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
                {empty > 0 && (
                    <div
                        className="bg-red-300 dark:bg-red-800 h-full transition-all duration-500"
                        style={{ width: `${100 - pct}%` }}
                    />
                )}
            </div>
        </div>
    )
}

// ─── Minister load bar ────────────────────────────────────────────────────────

function MinisterBar({
    name,
    assignments,
    max,
    avg,
    isOverloaded,
}: {
    name: string
    assignments: number
    max: number
    avg: number
    isOverloaded: boolean
}) {
    const pct = max > 0 ? Math.round((assignments / max) * 100) : 0
    const avgPct = max > 0 ? Math.round((avg / max) * 100) : 0
    const thresholdPct = max > 0 ? Math.min(Math.round((avg * 1.6 / max) * 100), 100) : 0
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
                <span className="text-sm text-foreground">{name}</span>
                <span className="text-xs text-muted-foreground">{assignments} escalas</span>
            </div>
            <div className="relative h-2 bg-muted rounded-full overflow-visible">
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
        </div>
    )
}

// ─── Event severity dot ───────────────────────────────────────────────────────

function SeverityDot({ empty }: { empty: number }) {
    if (empty === 0) return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 inline-block mt-1" />
    if (empty >= 3) return <span className="w-2 h-2 rounded-full bg-destructive shrink-0 inline-block mt-1" />
    return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 inline-block mt-1" />
}

// ─── Event row ────────────────────────────────────────────────────────────────
// Layout em 3 linhas empilhadas para evitar compressão no mobile:
//   1. Data + badge de status (não competem com a barra)
//   2. Barra de progresso + porcentagem com largura total
//   3. Funções faltando (linha própria, nunca espremida)

function EventRow({ event }: { event: AnalyticsEvent }) {
    const empty = event.empty_slots
    const pct = event.total_slots > 0 ? Math.round((event.filled_slots / event.total_slots) * 100) : 0
    const barColor =
        empty === 0 ? 'bg-green-500' : empty >= 3 ? 'bg-destructive' : 'bg-amber-500'

    return (
        <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 last:pb-0">
            <SeverityDot empty={empty} />

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                {/* Linha 1: data/tipo + badge — sem competição de espaço */}
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground leading-none">
                        {formatDateBr(event.event_date)} · {formatEventLabel(event.event_type)}
                    </p>
                    {empty === 0 ? (
                        <Badge
                            variant="outline"
                            className="text-green-700 dark:text-green-400 border-green-300 text-[10px] py-0 h-5 shrink-0"
                        >
                            Completo
                        </Badge>
                    ) : (
                        <Badge
                            variant={empty >= 3 ? 'destructive' : 'outline'}
                            className={cn('text-[10px] py-0 h-5 shrink-0', {
                                'text-amber-700 dark:text-amber-400 border-amber-300': empty < 3,
                            })}
                        >
                            {empty} {empty === 1 ? 'lacuna' : 'lacunas'}
                        </Badge>
                    )}
                </div>

                {/* Linha 2: barra ocupa toda a largura disponível + % alinhada à direita */}
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums w-8 text-right">
                        {pct}%
                    </span>
                </div>

                {/* Linha 3: funções faltando — linha própria, nunca espremida */}
                {event.missing_roles.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                        {event.missing_roles.join(' · ')}
                    </p>
                )}
            </div>
        </div>
    )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduleAdminDashboardPage() {
    const [loading, setLoading] = useState(true)
    const [loadingBimesters, setLoadingBimesters] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [eventFilter, setEventFilter] = useState<'all' | 'sunday' | 'thursday'>('all')

    const [bimesters, setBimesters] = useState<BimesterSummary[]>([])
    const [selectedBimesterId, setSelectedBimesterId] = useState<string>('')
    const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)

    const loadBimesters = useCallback(async () => {
        try {
            const response = await fetch('/api/schedule/quarters', { cache: 'no-store' })
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
            const response = await fetch(`/api/schedule/admin/analytics${suffix}`, { cache: 'no-store' })
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

    const filteredEvents = useMemo(() => {
        const events = analytics?.by_event ?? []
        if (eventFilter === 'sunday') return events.filter((e) => e.event_type === 'sunday')
        if (eventFilter === 'thursday') return events.filter((e) => e.event_type === 'thursday')
        return events
    }, [analytics?.by_event, eventFilter])

    const avg = analytics?.summary.average_assignments_per_minister ?? 0
    const overloadedMinisters = (analytics?.alerts.overloaded_ministers ?? []).slice(0, 8)
    const highRiskEvents = (analytics?.alerts.events_with_gaps ?? []).slice(0, 8)

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8 w-full max-w-full overflow-x-hidden">

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
                            <SelectTrigger className="min-w-[220px]">
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
                    <div className="space-y-4">

                        {/* ── Bimester header ── */}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                            <div>
                                <p className="text-sm font-medium text-foreground">{analytics.quarter.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {formatDateBr(analytics.quarter.start_date)} a {formatDateBr(analytics.quarter.end_date)}
                                </p>
                            </div>
                            <Badge variant={analytics.quarter.is_published ? 'default' : 'outline'}>
                                {analytics.quarter.is_published ? 'Publicado' : 'Rascunho'}
                            </Badge>
                        </div>

                        {/* ── KPIs ── */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <KpiCard
                                label="Cobertura geral"
                                value={`${analytics.summary.coverage_percent}%`}
                                sub={`${analytics.summary.filled_slots}/${analytics.summary.total_slots} posições`}
                                variant={analytics.summary.coverage_percent >= 80 ? 'success' : analytics.summary.coverage_percent < 60 ? 'danger' : 'default'}
                            />
                            <KpiCard
                                label="Vagas em aberto"
                                value={analytics.summary.empty_slots}
                                sub="Sem ministro definido"
                                variant={analytics.summary.empty_slots > 0 ? 'danger' : 'success'}
                            />
                            <KpiCard
                                label="Sobrecarregados"
                                value={analytics.summary.overloaded_ministers}
                                sub="Acima de 30% da média"
                                variant={analytics.summary.overloaded_ministers > 0 ? 'danger' : 'success'}
                            />
                            <KpiCard
                                label="Aprendizes"
                                value={analytics.summary.trainees}
                                sub="Alocações como trainee"
                            />
                        </div>

                        {/* ── Charts row ── */}
                        <div className="grid gap-4 lg:grid-cols-2">

                            <Card className='py-4'>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                                        Cobertura por Função
                                    </CardTitle>
                                    <CardDescription className="text-xs">Preenchido vs. vazio por papel na escala</CardDescription>
                                    <div className="flex items-center gap-4 pt-1">
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" />
                                            Preenchido
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-red-300 dark:bg-red-800 inline-block" />
                                            Vazio
                                        </span>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-3">
                                    {analytics.by_role.map((role) => (
                                        <CoverageBar
                                            key={role.role_id}
                                            label={role.role_name}
                                            filled={role.filled}
                                            total={role.total}
                                        />
                                    ))}
                                </CardContent>
                            </Card>

                            <Card className='py-4'>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        Carga por Ministro
                                    </CardTitle>
                                    <CardDescription className="text-xs">Top 10 · linha laranja = média do bimestre</CardDescription>
                                    <div className="flex items-center gap-4 pt-1 flex-wrap">
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
                                </CardHeader>
                                <CardContent className="flex flex-col gap-3">
                                    {(analytics.by_minister ?? []).slice(0, 10).map((m) => (
                                        <MinisterBar
                                            key={m.minister_id}
                                            name={m.name}
                                            assignments={m.total_assignments}
                                            max={maxAssignments}
                                            avg={avg}
                                            isOverloaded={m.is_overloaded}
                                        />
                                    ))}
                                </CardContent>
                            </Card>
                        </div>

                        {/* ── Alerts row ── */}
                        <div className="grid gap-4 lg:grid-cols-2">

                            <Card className="py-4">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                                        Alertas de Sobrecarga
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Ministros acima do limite de +30% da média
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-4 overflow-hidden">
                                    {overloadedMinisters.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-2">Nenhum alerta de sobrecarga.</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {overloadedMinisters.map((item) => (
                                                <div
                                                    key={item.minister_id}
                                                    className="rounded-lg bg-destructive/8 border border-destructive/20 px-3 py-2.5"
                                                >
                                                    {/* Linha 1: nome + badge na mesma linha com truncate seguro */}
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <p className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                                                            {item.name}
                                                        </p>
                                                        <span className="text-xs font-semibold text-destructive shrink-0 tabular-nums">
                                                            +{item.overload_delta_percent}%
                                                        </span>
                                                    </div>
                                                    {/* Linha 2: subtexto */}
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        {item.total_assignments} alocações no bimestre
                                                    </p>
                                                    {/* Linha 3: barra de sobrecarga visual */}
                                                    <div className="mt-2 h-1 rounded-full bg-destructive/20 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-destructive transition-all duration-500"
                                                            style={{
                                                                width: `${Math.min(100, Math.round((item.overload_delta_percent / 150) * 100))}%`,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>


                            <Card className="py-4">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <CalendarClock className="h-4 w-4 text-muted-foreground" />
                                        Eventos com Lacunas
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Próximos cultos com vagas em aberto
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-4 overflow-hidden">
                                    {highRiskEvents.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-2">Nenhum evento com lacuna.</p>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {highRiskEvents.map((event) => {
                                                const isCritical = event.empty_slots >= 3
                                                return (
                                                    <div
                                                        key={`${event.event_date}_${event.event_type}`}
                                                        className={cn(
                                                            'rounded-lg border px-3 py-2.5',
                                                            isCritical
                                                                ? 'bg-destructive/8 border-destructive/20'
                                                                : 'bg-amber-500/8 border-amber-500/20',
                                                        )}
                                                    >
                                                        {/* Linha 1: data/tipo + contagem de vagas */}
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <SeverityDot empty={event.empty_slots} />
                                                            <p className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                                                                {formatDateBr(event.event_date)} · {formatEventLabel(event.event_type)}
                                                            </p>
                                                            <span
                                                                className={cn(
                                                                    'text-xs font-semibold shrink-0 tabular-nums',
                                                                    isCritical ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
                                                                )}
                                                            >
                                                                {event.empty_slots} {event.empty_slots === 1 ? 'vaga' : 'vagas'}
                                                            </span>
                                                        </div>

                                                        {/* Linha 2: roles faltando em chips — quebram linha, nunca estourame */}
                                                        {event.missing_roles.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {event.missing_roles.map((role) => (
                                                                    <span
                                                                        key={role}
                                                                        className="inline-flex items-center rounded-md bg-background/60 border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none"
                                                                    >
                                                                        {role}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* ── Events summary ── */}
                        <Card className="py-4">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                                    Resumo por Evento
                                </CardTitle>
                                <CardDescription className="text-xs">Visão operacional de preenchimento por culto</CardDescription>

                                <div className="flex gap-0 border-b border-border mt-3 -mb-1">
                                    {(['all', 'sunday', 'thursday'] as const).map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setEventFilter(tab)}
                                            className={cn(
                                                'px-3 py-2 text-xs border-b-2 transition-colors',
                                                eventFilter === tab
                                                    ? 'border-primary text-foreground font-medium'
                                                    : 'border-transparent text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            {tab === 'all' ? 'Todos' : tab === 'sunday' ? 'Domingos' : 'Quintas'}
                                        </button>
                                    ))}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {filteredEvents.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-2">Nenhum evento neste filtro.</p>
                                ) : (
                                    <div>
                                        {filteredEvents.slice(0, 16).map((event) => (
                                            <EventRow key={`${event.event_date}_${event.event_type}`} event={event} />
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Minister detail ── */}
                        <Card className="py-4">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <UserRound className="h-4 w-4 text-muted-foreground" />
                                    Distribuição por Ministro
                                </CardTitle>
                                <CardDescription className="text-xs">Equilíbrio geral da equipe</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div>
                                    {(analytics.by_minister ?? []).slice(0, 20).map((minister) => (
                                        <div
                                            key={minister.minister_id}
                                            className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0 last:pb-0"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div
                                                    className={cn(
                                                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                                                        minister.is_overloaded
                                                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                                                            : 'bg-muted text-muted-foreground',
                                                    )}
                                                >
                                                    {getInitials(minister.name)}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-foreground truncate">{minister.name}</p>
                                                    <p className="text-xs text-muted-foreground">{minister.instrument}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Badge variant="outline" className="text-xs">{minister.total_assignments} escalas</Badge>
                                                {/* Badges de status visíveis apenas em sm+ para não cortar no mobile */}
                                                {minister.is_overloaded && (
                                                    <Badge variant="destructive" className="text-xs hidden sm:inline-flex">Sobrecarregado</Badge>
                                                )}
                                                {minister.is_underutilized && (
                                                    <Badge variant="secondary" className="text-xs hidden sm:inline-flex">Subutilizado</Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                    </div>
                )}
            </main>
        </div>
    )
}