'use client'

import { PAGE_WIDTH } from '@/lib/page-layout'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { CalendarDays, Check, ChevronDown, LayoutGrid, List, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BimesterForm } from '@/components/schedule/BimesterForm'
import type { ScheduleAssignment, ScheduleEventControl, ScheduleRehearsal } from '@/components/schedule/ScheduleGrid'
import { selectedChurchFetch } from '@/lib/auth/client-context'
import { buildEvents, clearUnassignedLeaders, filterEvents, summarizeEvents, type BuilderData, type BuilderEvent, type BuilderPeriod, type EventFilter, type TypeFilter } from '@/lib/schedule/builder-model'
import { useToast } from '@/hooks/use-toast'
import type { SaveAssignment } from './assignment-picker'
import { BuilderSettings } from './builder-settings'
import { ImportScheduleDialog, type ImportItem } from './import-schedule-dialog'
import { PublishReview } from './publish-review'
import { ScheduleBuilderHeader } from './schedule-builder-header'
import { ScheduleEventEditor, type EventControlChange, type RehearsalChange } from './schedule-event-editor'
import { ScheduleEventList } from './schedule-event-list'
import { ScheduleSaveStatus, type SaveState } from './schedule-save-status'
import { useScheduleMutation } from './use-schedule-mutation'

const ScheduleGrid = dynamic(() => import('@/components/schedule/ScheduleGrid').then(module => module.ScheduleGrid), {
  loading: () => <BuilderSkeleton />,
})

interface MutationResponse {
  error?: string; assignment?: ScheduleAssignment; control?: ScheduleEventControl; rehearsal?: ScheduleRehearsal
  quarter?: BuilderPeriod; notification_error?: string; notification?: { failed?: number }
  notifications?: { failed?: number }; calendar_sync?: { errors?: unknown[] }; updated_count?: number
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await selectedChurchFetch(url, { signal })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a escala.')
  return body as T
}

function BuilderSkeleton() {
  return <div role="status" aria-label="Carregando cultos" className="space-y-3 py-4">{[0, 1, 2].map(i => <div key={i} className="h-32 animate-pulse rounded-xl border bg-muted/50" />)}<span className="sr-only">Carregando escala…</span></div>
}

export function ScheduleBuilder() {
  const pathname = usePathname(), params = useSearchParams()
  const { toast } = useToast()
  const { request, conflictDialog } = useScheduleMutation()
  const [periods, setPeriods] = useState<BuilderPeriod[]>([])
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [periodsError, setPeriodsError] = useState<string | null>(null)
  const [periodRetry, setPeriodRetry] = useState(0)
  const [data, setData] = useState<BuilderData | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [rehearsals, setRehearsals] = useState<ScheduleRehearsal[]>([])
  const [rehearsalError, setRehearsalError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, SaveState>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false), [reviewOpen, setReviewOpen] = useState(false)
  const [requestedAction, setRequestedAction] = useState<{ key: string; action: 'cancel' | 'reactivate' } | null>(null)
  const writeLock = useRef(false)
  const dataVersion = useRef(0)
  const activePeriod = useRef('')
  const busy = savingKey !== null
  const quarterId = params.get('quarter') || periods.find(period => period.is_published)?.id || periods[0]?.id || ''
  activePeriod.current = quarterId
  const period = periods.find(item => item.id === quarterId)
  const currentData = data?.quarter.id === quarterId ? data : null
  const filter: EventFilter = params.get('filter') === 'pending' ? 'pending' : params.get('filter') === 'cancelled' ? 'cancelled' : 'all'
  const type: TypeFilter = params.get('type') === 'thursday' ? 'thursday' : params.get('type') === 'sunday' ? 'sunday' : 'all'
  const view = params.get('view') === 'grid' ? 'grid' : 'agenda'
  const selectedKey = params.get('event')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterSummary = `${{ all: 'Todos', pending: 'Com pendências', cancelled: 'Cancelados' }[filter]} · ${{ all: 'Quintas e domingos', thursday: 'Quintas', sunday: 'Domingos' }[type]}`
  // No celular, a grade só aparece com um tipo de culto escolhido, porque a semana inteira não cabe na tela.
  const gridOnMobile = view === 'grid' && type !== 'all'

  const navigate = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params.toString())
    if (quarterId) next.set('quarter', quarterId)
    for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value) }
    const href = `${pathname}?${next.toString()}`
    // These parameters only select already loaded client data. Native history
    // integrates with useSearchParams without another server navigation/loading flash.
    if (replace) window.history.replaceState(null, '', href); else window.history.pushState(null, '', href)
  }

  useEffect(() => {
    // Pin the initial fallback period so publishing/unpublishing cannot silently
    // switch the editor to a different period when the list's statuses change.
    if (!params.get('quarter') && quarterId) {
      const next = new URLSearchParams(params.toString())
      next.set('quarter', quarterId)
      window.history.replaceState(null, '', `${pathname}?${next}`)
    }
  }, [params, pathname, quarterId])

  useEffect(() => {
    const controller = new AbortController()
    setPeriodsLoading(true); setPeriodsError(null)
    getJson<{ quarters: BuilderPeriod[] }>('/api/schedule/quarters', controller.signal).then(body => {
      if (!controller.signal.aborted) setPeriods(body.quarters)
    }).catch(err => { if (!controller.signal.aborted) setPeriodsError(err instanceof Error ? err.message : 'Falha ao carregar períodos.') })
      .finally(() => { if (!controller.signal.aborted) setPeriodsLoading(false) })
    return () => controller.abort()
  }, [periodRetry])

  const loadData = useCallback(async (id: string, signal?: AbortSignal) => {
    const version = ++dataVersion.current
    setDataError(null)
    const [assignments, rehearsal] = await Promise.allSettled([
      getJson<BuilderData>(`/api/schedule/quarters/${id}/assignments`, signal),
      getJson<{ rehearsals: ScheduleRehearsal[] }>(`/api/schedule/rehearsal?quarter_id=${id}`, signal),
    ])
    if (signal?.aborted || activePeriod.current !== id || version !== dataVersion.current) return false
    if (assignments.status === 'rejected') {
      setDataError(assignments.reason instanceof Error ? assignments.reason.message : 'Falha ao carregar cultos.')
      return false
    }
    setData(assignments.value)
    if (rehearsal.status === 'fulfilled') { setRehearsals(rehearsal.value.rehearsals); setRehearsalError(null) }
    else { setRehearsalError('Não foi possível carregar os ensaios. Tente novamente antes de editá-los.'); setRehearsals([]) }
    return true
  }, [])

  useEffect(() => {
    setStatuses({}); setData(null); setRehearsals([]); setRehearsalError(null); setDataError(null)
    if (!quarterId || !period) return
    const controller = new AbortController()
    void loadData(quarterId, controller.signal)
    return () => controller.abort()
  // Only period identity should reset the editor, not a publication/name update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterId, Boolean(period), loadData])

  useEffect(() => {
    if (!reload || !quarterId || writeLock.current) return
    const controller = new AbortController()
    void loadData(quarterId, controller.signal).then(ok => { if (ok) setStatuses({}) })
    return () => controller.abort()
  }, [reload, quarterId, loadData])

  const events = useMemo(() => currentData ? buildEvents(currentData, rehearsals) : [], [currentData, rehearsals])
  const minister = params.get('minister') || ''
  const ministerName = currentData?.active_ministers.find(item => item.id === minister)?.name ?? 'ministro selecionado'
  const visible = useMemo(() => filterEvents(events, filter, type).filter(event => !minister || event.assignments.some(item => item.minister_id === minister)), [events, filter, type, minister])
  const summary = useMemo(() => summarizeEvents(events), [events])
  const selected = events.find(event => event.key === selectedKey)
  const listScroll = useRef(0), previousEvent = useRef<string | null>(null)
  useEffect(() => {
    if (selectedKey) {
      if (!previousEvent.current) listScroll.current = window.scrollY
      if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0 })
    } else if (previousEvent.current && window.matchMedia('(max-width: 1023px)').matches) {
      window.scrollTo({ top: listScroll.current })
    }
    previousEvent.current = selectedKey
  }, [selectedKey])

  const execute = async (key: string, url: string, body: object, apply?: (result: MutationResponse) => void | Promise<void>, method = 'PATCH'): Promise<MutationResponse> => {
    if (writeLock.current) throw new Error('Aguarde o salvamento em andamento.')
    const scope = quarterId
    writeLock.current = true; dataVersion.current += 1; setSavingKey(key)
    setStatuses(current => ({ ...current, [key]: { state: 'saving' } }))
    try {
      const response = await request(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(body) })
      const result = await response.json() as MutationResponse
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar. Confira a conexão e tente novamente.')
      if (activePeriod.current === scope) {
        await apply?.(result)
        setStatuses(current => ({ ...current, [key]: { state: 'saved' } }))
        const warnings = [result.notification_error,
          (result.notification?.failed || result.notifications?.failed) ? 'Um ou mais avisos precisam de nova tentativa ou conferência administrativa.' : null,
          result.calendar_sync?.errors?.length ? 'Houve falha na sincronização do calendário.' : null].filter(Boolean)
        if (warnings.length) toast({ title: 'Alteração salva com avisos', description: warnings.join(' '), variant: 'destructive' })
      }
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Não foi possível salvar.')
      if (activePeriod.current === scope) setStatuses(current => ({ ...current, [key]: { state: 'error', message: error.message,
        retry: () => execute(key, url, body, apply, method) } }))
      throw error
    } finally { writeLock.current = false; setSavingKey(null) }
  }

  const saveAssignment: SaveAssignment = async (assignment, minister, trainee) => {
    await execute(assignment.id, '/api/schedule/assignment', {
      id: assignment.id, quarter_id: assignment.quarter_id, role_id: assignment.role_id,
      event_date: assignment.event_date, event_type: assignment.event_type, minister_id: minister?.id ?? null, is_trainee: trainee,
    }, result => { if (result.assignment) setData(current => current?.quarter.id === assignment.quarter_id ? clearUnassignedLeaders(current, result.assignment!) : current) })
  }
  const saveControl = async (event: BuilderEvent, change: EventControlChange) => {
    const id = quarterId
    await execute(`control:${event.key}`, '/api/schedule/event-control', {
      quarter_id: id, event_date: event.date, event_type: event.type,
      ...(change.action ? { action: change.action } : { leader_minister_id: change.leaderMinisterId ?? null }),
    }, result => {
      if (result.control) setData(current => current?.quarter.id === id ? { ...current, event_controls: [
        ...current.event_controls.filter(item => `${item.event_date}_${item.event_type}` !== event.key),
        { ...result.control!, leader: current.active_ministers.find(person => person.id === result.control!.leader_minister_id) ?? null },
      ] } : current)
    })
  }
  const saveRehearsal = async (event: BuilderEvent, change: RehearsalChange) => {
    await execute(`rehearsal:${event.key}`, '/api/schedule/rehearsal', {
      quarter_id: quarterId, event_date: event.date, event_type: event.type, ...change,
    }, result => { if (result.rehearsal) setRehearsals(current => [...current.filter(item => `${item.event_date}_${item.event_type}` !== event.key), result.rehearsal!]) })
  }
  const failures = Object.entries(statuses).filter(([, status]) => status.state === 'error')
  const blockedReason = busy ? 'Aguarde o salvamento em andamento.' : failures.length ? 'Resolva as alterações que falharam antes de publicar.' : rehearsalError ? 'Carregue os ensaios para concluir a revisão.' : !currentData || dataError ? 'Carregue a escala para revisar a publicação.' : null
  const openEvent = (event: BuilderEvent) => navigate({ event: event.key, view: null })
  const neighboring = visible.some(event => event.key === selectedKey) ? visible : events
  const selectedIndex = neighboring.findIndex(event => event.key === selectedKey)
  const selectedPeriod = currentData?.quarter ?? period

  return <main className={`${PAGE_WIDTH} pb-36 pt-3 sm:pt-5 lg:pb-12`}>
    <ScheduleBuilderHeader periods={periods} selectedId={quarterId} loading={periodsLoading} busy={busy}
      onSelect={id => navigate({ quarter: id, event: null })} onCreate={() => setCreateOpen(true)} onImport={() => setImportOpen(true)} onSettings={() => setSettingsOpen(true)} />
    {periodsError ? <div role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm"><p>{periodsError}</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => setPeriodRetry(value => value + 1)}>Tentar novamente</Button></div> : null}
    {!periodsLoading && !periodsError && !periods.length ? <section className="mt-6 rounded-xl border bg-card px-5 py-12 text-center"><CalendarDays className="mx-auto mb-4 h-8 w-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Vamos montar a primeira escala?</h2><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Crie um período. Depois, abra cada culto para escolher a equipe. Ele fica privado até você publicar.</p><Button className="mt-6 min-h-12" onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Criar período</Button></section> : null}
    {!periodsLoading && quarterId && !period ? <div role="alert" className="mt-5 rounded-xl border p-4 text-sm">Este período não está disponível. Escolha outro no seletor acima.</div> : null}
    {dataError ? <div role="alert" className="mt-5 rounded-xl border border-destructive/30 p-4 text-sm"><p>{dataError}</p><Button className="mt-3 min-h-11" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>Carregar escala novamente</Button></div> : null}
    {rehearsalError && !selectedKey ? <div role="alert" className="mt-4 rounded-xl border border-amber-500/30 p-4 text-sm"><p>{rehearsalError}</p><Button variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={() => setReload(value => value + 1)}>Carregar ensaios novamente</Button></div> : null}
    {failures.length ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="font-medium">Há alterações que não foram confirmadas.</p><p className="mt-1 text-muted-foreground">A publicação fica pausada. Tente salvar novamente ou recarregue os dados confirmados no servidor.</p><div className="mt-2 space-y-2">{failures.map(([key, status]) => <ScheduleSaveStatus key={key} status={status} />)}</div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>Recarregar dados salvos</Button></div> : null}
    {(periodsLoading || (period && !currentData && !dataError)) ? <BuilderSkeleton /> : null}
    {currentData ? <>
      <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 ${selectedKey ? 'hidden lg:flex' : ''}`}>
        <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{summary.events} cultos</span> · {summary.pendingEvents ? `${summary.pendingEvents} para completar` : 'Equipes preenchidas'}</p>
        {type === 'all' ? <span className="text-xs text-muted-foreground lg:hidden">Para ver a grade, filtre por Quintas ou Domingos.</span> : null}
        <div className={`${type === 'all' ? 'hidden lg:flex' : 'flex'} items-center gap-1 rounded-lg border p-1`} role="group" aria-label="Visualização da escala"><Button className="min-h-11" size="sm" variant={view === 'agenda' ? 'secondary' : 'ghost'} aria-pressed={view === 'agenda'} onClick={() => navigate({ view: null }, true)}><List className="mr-2 h-4 w-4" />Agenda</Button><Button className="min-h-11" size="sm" variant={view === 'grid' ? 'secondary' : 'ghost'} aria-pressed={view === 'grid'} onClick={() => navigate({ view: 'grid', event: null }, true)}><LayoutGrid className="mr-2 h-4 w-4" />Grade</Button></div>
      </div>
      <Button variant="outline" className={`mt-3 min-h-11 w-full justify-between lg:hidden ${selectedKey ? 'hidden' : ''}`} aria-expanded={filtersOpen} aria-controls="builder-filters" onClick={() => setFiltersOpen(open => !open)}>
        <span className="truncate">Filtros: {filterSummary}</span><ChevronDown className={`ml-2 h-4 w-4 shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>
      <div id="builder-filters" className={`mt-3 flex-wrap items-center gap-2 ${selectedKey ? 'hidden lg:flex' : filtersOpen ? 'flex' : 'hidden lg:flex'}`}>
        <div role="group" aria-label="Filtrar cultos" className="flex min-w-0 flex-wrap gap-1 rounded-lg bg-muted/70 p-1">{([{ value: 'all', label: 'Todos' }, { value: 'pending', label: 'Com pendências' }, { value: 'cancelled', label: 'Cancelados' }] as const).map(item => <Button key={item.value} variant={filter === item.value ? 'secondary' : 'ghost'} size="sm" className="min-h-11 px-3 text-xs sm:text-sm" disabled={busy} aria-pressed={filter === item.value} onClick={() => navigate({ filter: item.value === 'all' ? null : item.value }, true)}>{item.label}</Button>)}</div>
        <label className="ml-auto flex min-h-11 items-center gap-2 text-xs text-muted-foreground"><span className="sr-only">Tipo de culto</span><select value={type} disabled={busy} onChange={e => navigate({ type: e.target.value === 'all' ? null : e.target.value }, true)} className="min-h-11 rounded-lg border bg-background px-2 text-sm text-foreground"><option value="all">Quintas e domingos</option><option value="thursday">Quintas</option><option value="sunday">Domingos</option></select></label>
      </div>
      {minister ? <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>Mostrando cultos de <span className="font-medium">{ministerName}</span></span><Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => navigate({ minister: null }, true)}>Mostrar todos os cultos</Button></div> : null}
      <div className={`mt-2 items-start gap-6 ${view === 'grid' ? (gridOnMobile ? 'hidden' : 'grid lg:hidden') : 'grid lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]'}`}>
        <div className={`min-w-0 ${selectedKey ? 'hidden lg:block' : ''}`}>
          {visible.length ? <ScheduleEventList events={visible} period={currentData.quarter} selectedKey={selectedKey} onOpen={openEvent} /> : <section className="mt-5 rounded-xl border bg-card px-5 py-10 text-center"><h2 className="text-base font-medium">{events.length ? 'Nenhum culto neste filtro' : 'Nenhum culto neste período'}</h2><p className="mt-2 text-sm text-muted-foreground">{events.length ? 'Escolha outro filtro para continuar montando a escala.' : 'Confira as datas e as atribuições do período.'}</p>{events.length ? <Button variant="outline" className="mt-4 min-h-11" onClick={() => navigate({ filter: null, type: null, minister: null }, true)}>Limpar filtros</Button> : null}</section>}
        </div>
        <div className={`min-w-0 pt-5 ${selectedKey ? '' : 'hidden lg:block'}`}>
          {selected ? <ScheduleEventEditor key={selected.key} data={currentData} event={selected} events={events} statuses={statuses} busy={busy}
            initialAction={requestedAction?.key === selected.key ? requestedAction.action : undefined}
            onInitialActionHandled={() => setRequestedAction(null)}
            rehearsalError={rehearsalError} onRetryRehearsals={() => setReload(value => value + 1)} onBack={() => navigate({ event: null })}
            hasPrevious={selectedIndex > 0} hasNext={selectedIndex >= 0 && selectedIndex < neighboring.length - 1}
            onNavigate={direction => { const event = neighboring[selectedIndex + direction]; if (event) openEvent(event) }}
            onSaveAssignment={saveAssignment} onSaveControl={change => saveControl(selected, change)} onSaveRehearsal={change => saveRehearsal(selected, change)} />
            : <section className="rounded-xl border border-dashed p-8 text-center"><CalendarDays className="mx-auto mb-4 h-7 w-7 text-muted-foreground" /><h2 className="text-lg font-semibold">{selectedKey ? 'Culto não encontrado' : 'Escolha um culto para começar'}</h2><p className="mt-2 text-sm text-muted-foreground">{selectedKey ? 'Ele pode não fazer parte deste período.' : 'Abra uma data ao lado para montar a equipe, definir o responsável e combinar o ensaio.'}</p>{selectedKey ? <Button variant="outline" className="mt-4 min-h-11" onClick={() => navigate({ event: null })}>Voltar aos cultos</Button> : null}</section>}
        </div>
      </div>
      {view === 'grid' ? <div className={`mt-5 space-y-5 ${gridOnMobile ? 'block' : 'hidden lg:block'}`}>{!visible.length ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">Nenhum culto neste filtro. Escolha outro filtro acima.</p> : null}{(['thursday', 'sunday'] as const).filter(eventType => visible.some(event => event.type === eventType)).map(eventType => <section key={eventType}><h2 className="mb-3 text-base font-semibold">{eventType === 'thursday' ? 'Quintas' : 'Domingos'}</h2><ScheduleGrid roles={currentData.roles.filter(role => currentData.assignments.some(item => item.role_id === role.id && item.event_type === eventType))} dates={visible.filter(event => event.type === eventType).map(event => event.date)} eventType={eventType}
        assignments={currentData.assignments} readOnly={busy} savingKeys={Object.fromEntries(Object.entries(statuses).map(([key, status]) => [key, status.state === 'saving']))}
        onSaveAssignment={async payload => { const assignment = currentData.assignments.find(item => item.id === payload.id); if (assignment) await saveAssignment(assignment, payload.minister_id ? { id: payload.minister_id, name: payload.minister_name ?? '', avatar_url: payload.minister_avatar_url } : null, payload.is_trainee) }}
        eventControls={currentData.event_controls} activeMinisters={currentData.active_ministers} isPublished={currentData.quarter.is_published}
        rehearsalByDate={Object.fromEntries(rehearsals.map(item => [`${item.event_date}_${item.event_type}`, item]))} rehearsalStatus={rehearsalError ? 'error' : 'ready'} canEditRehearsal={(date, eventType) => !busy && !events.find(item => item.date === date && item.type === eventType)?.cancelled}
        onSaveRehearsal={async payload => { const event = events.find(item => item.date === payload.eventDate && item.type === payload.eventType); if (event) await saveRehearsal(event, { rehearsal_date: payload.rehearsalDate, rehearsal_time: payload.rehearsalTime, rehearsal_place: payload.rehearsalPlace }) }}
        onSaveEventControl={async payload => { const event = events.find(item => item.date === payload.eventDate && item.type === payload.eventType); if (event) { if (payload.action) { setRequestedAction({ key: event.key, action: payload.action }); openEvent(event) } else await saveControl(event, payload) } }}
      /></section>)}</div> : null}
    </> : null}
    {selectedPeriod ? <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm md:static md:mt-6 md:rounded-xl md:border md:bg-card md:p-4">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3"><p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">{busy ? 'Salvando alterações…' : failures.length ? 'Há alterações não salvas' : <><Check className="h-3.5 w-3.5" />{Object.keys(statuses).length ? 'Alterações salvas automaticamente' : 'Salvamento automático ativo'}</>}</p><Button className="min-h-12 flex-1 sm:flex-none" variant={selectedPeriod.is_published ? 'outline' : 'default'} disabled={Boolean(blockedReason)} onClick={() => setReviewOpen(true)}>{selectedPeriod.is_published ? 'Revisar despublicação' : 'Revisar publicação'}</Button></div>
    </footer> : null}
    <BimesterForm open={createOpen} onOpenChange={setCreateOpen} existingBimesters={periods} onCreated={created => { setPeriods(current => [created, ...current]); navigate({ quarter: created.id, event: null, filter: null, type: null, view: null }) }} />
    <BuilderSettings open={settingsOpen} onOpenChange={setSettingsOpen} periodName={selectedPeriod?.name} busy={busy} onDelete={async () => {
      if (!selectedPeriod) return
      const id = selectedPeriod.id
      await execute('delete', `/api/schedule/quarters/${id}`, {}, () => { setPeriods(current => current.filter(item => item.id !== id)); navigate({ quarter: null, event: null }, true); setData(null) }, 'DELETE')
    }} />
    {quarterId ? <ImportScheduleDialog key={`${quarterId}:${importOpen}`} open={importOpen} onOpenChange={setImportOpen} quarterId={quarterId} busy={busy} onApply={async (items: ImportItem[]) => {
      await execute('import', `/api/schedule/quarters/${quarterId}/import/apply`, { items }, async () => {
        if (!await loadData(quarterId)) throw new Error('A importação foi aplicada, mas não foi possível carregar a escala atualizada. Recarregue os dados salvos.')
      }, 'POST')
      toast({ title: 'Importação aplicada', description: 'Confira a equipe atualizada na agenda.' })
    }} /> : null}
    {selectedPeriod ? <PublishReview open={reviewOpen} onOpenChange={setReviewOpen} period={selectedPeriod}
      previous={periods.filter(item => item.is_published && item.id !== selectedPeriod.id).map(item => item.name).join(', ')} summary={summary} busy={busy} blockedReason={savingKey === 'publication' ? null : blockedReason}
      onConfirm={async () => { await execute('publication', `/api/schedule/quarters/${quarterId}/publish`, { is_published: !selectedPeriod.is_published }, result => {
        if (!result.quarter) return
        const updated = result.quarter
        setPeriods(current => current.map(item => item.id === updated.id ? updated : updated.is_published ? { ...item, is_published: false } : item))
        setData(current => current?.quarter.id === updated.id ? { ...current, quarter: updated } : current)
        toast({ title: updated.is_published ? 'Escala publicada' : 'Período despublicado', description: updated.is_published ? 'A equipe já pode consultar a escala.' : 'O período voltou a ser um rascunho privado.' })
      }) }} /> : null}
    {conflictDialog}
  </main>
}
