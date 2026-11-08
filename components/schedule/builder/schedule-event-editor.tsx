'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { BuilderData, BuilderEvent } from '@/lib/schedule/builder-model'
import { eventTime } from '@/lib/schedule/builder-model'
import type { ScheduleRehearsal } from '@/components/schedule/ScheduleGrid'
import { AssignmentPicker, type SaveAssignment } from './assignment-picker'
import { eventDateLabel } from './schedule-event-list'
import { ScheduleSaveStatus, type SaveState } from './schedule-save-status'

export interface EventControlChange { leaderMinisterId?: string | null; action?: 'cancel' | 'reactivate' }
export type RehearsalChange = Pick<ScheduleRehearsal, 'rehearsal_date' | 'rehearsal_time' | 'rehearsal_place'>

export function ScheduleEventEditor({ data, event, statuses, busy, initialAction, onInitialActionHandled, rehearsalError, onRetryRehearsals, onBack, onNavigate, hasPrevious, hasNext, onSaveAssignment, onSaveControl, onSaveRehearsal }: {
  data: BuilderData; event: BuilderEvent; statuses: Record<string, SaveState>; busy: boolean
  initialAction?: 'cancel' | 'reactivate'
  onInitialActionHandled: () => void
  rehearsalError: string | null; onRetryRehearsals: () => void
  onBack: () => void; onNavigate: (direction: -1 | 1) => void; hasPrevious: boolean; hasNext: boolean
  onSaveAssignment: SaveAssignment
  onSaveControl: (change: EventControlChange) => Promise<void>
  onSaveRehearsal: (change: RehearsalChange) => Promise<void>
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const [rehearsalOpen, setRehearsalOpen] = useState(false)
  const [leaderOpen, setLeaderOpen] = useState(false)
  const [action, setAction] = useState<'cancel' | 'reactivate' | null>(initialAction ?? null)
  useEffect(() => { if (initialAction) { setAction(initialAction); onInitialActionHandled() } }, [initialAction, onInitialActionHandled])
  const [localError, setLocalError] = useState<string | null>(null)
  const [date, setDate] = useState(event.rehearsal?.rehearsal_date ?? '')
  const [time, setTime] = useState(event.rehearsal?.rehearsal_time?.slice(0, 5) ?? '')
  const [place, setPlace] = useState(event.rehearsal?.rehearsal_place ?? '')
  useEffect(() => { title.current?.focus({ preventScroll: true }) }, [event.key])
  const assigned = new Set(event.assignments.map(item => item.minister_id).filter(Boolean))
  const leaders = data.active_ministers.filter(person => assigned.has(person.id))
  const roleMap = new Map(data.roles.map(role => [role.id, role]))
  const groups = [
    { category: 'ministro', title: 'Ministração' }, { category: 'vocal', title: 'Vozes' },
    { category: 'instrumento', title: 'Instrumentos' }, { category: 'midia', title: 'Equipe técnica' },
  ]
  const openRehearsal = () => {
    setDate(event.rehearsal?.rehearsal_date ?? '')
    setTime(event.rehearsal?.rehearsal_time?.slice(0, 5) ?? '')
    setPlace(event.rehearsal?.rehearsal_place ?? '')
    setLocalError(null)
    setRehearsalOpen(true)
  }
  const save = async (operation: () => Promise<void>, close: () => void) => {
    setLocalError(null)
    try { await operation(); close() } catch (error) { setLocalError(error instanceof Error ? error.message : 'Não foi possível salvar.') }
  }
  return <section aria-label="Editar culto" className="min-w-0 rounded-xl border bg-card lg:sticky lg:top-4">
    <header className="border-b p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" className="-ml-2 min-h-11 px-2 text-muted-foreground" onClick={onBack} disabled={busy}><ArrowLeft className="mr-1.5 h-4 w-4" />Todos os cultos</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Opções do culto" disabled={busy}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!data.quarter.is_published} className="min-h-11" onSelect={() => { setLocalError(null); setAction(event.cancelled ? 'reactivate' : 'cancel') }}>{event.cancelled ? 'Reativar culto' : 'Cancelar culto'}</DropdownMenuItem>
          {!data.quarter.is_published ? <p className="max-w-60 px-2 py-2 text-xs text-muted-foreground">O cancelamento fica disponível após a publicação.</p> : null}
        </DropdownMenuContent></DropdownMenu>
      </div>
      <h2 ref={title} tabIndex={-1} className="text-xl font-semibold capitalize tracking-tight outline-none">{eventDateLabel(event.date)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Culto às {eventTime(data.quarter, event.type, 'service')} · Chegada às {eventTime(data.quarter, event.type, 'arrival')}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-muted px-2 py-1">{event.cancelled ? 'Cancelado · histórico preservado' : data.quarter.is_published ? 'Publicado' : 'Rascunho'}</span><span className="rounded-md bg-muted px-2 py-1">{event.filled} de {event.total} funções preenchidas</span></div>
    </header>
    {event.cancelled ? <div className="mx-4 mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">Este culto está cancelado. As atribuições foram preservadas e não podem ser editadas aqui enquanto ele estiver cancelado.</div> : null}
    <div className="space-y-5 px-2 py-5 sm:px-3">
      {groups.map(group => {
        const assignments = event.assignments.filter(item => roleMap.get(item.role_id)?.category === group.category)
        if (!assignments.length) return null
        return <section key={group.category} aria-label={group.title}><h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h3><div className="divide-y divide-border/60">{assignments.map(assignment => {
          const role = roleMap.get(assignment.role_id)!
          return <div key={assignment.id}><AssignmentPicker assignment={assignment} role={role} eventLabel={eventDateLabel(event.date)} disabled={busy || event.cancelled} onSave={onSaveAssignment} /><ScheduleSaveStatus status={statuses[assignment.id]} /></div>
        })}</div></section>
      })}
    </div>
    <div className="mx-4 mb-5 divide-y rounded-lg border">
      <div><button type="button" disabled={busy || event.cancelled} onClick={() => { setLocalError(null); setLeaderOpen(true) }} className="flex min-h-20 w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"><span><span className="block text-xs text-muted-foreground">Responsável pelo culto</span><span className="mt-1 block text-sm font-medium">{event.control?.leader?.name ?? 'Definir responsável'}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button><ScheduleSaveStatus status={statuses[`control:${event.key}`]} /></div>
      <div><button type="button" disabled={busy || event.cancelled || Boolean(rehearsalError)} onClick={openRehearsal} className="flex min-h-20 w-full items-center gap-3 p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"><CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">Ensaio</span><span className="mt-1 block text-sm font-medium">{event.rehearsal?.rehearsal_date ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${event.rehearsal.rehearsal_date}T12:00:00`)) : 'Data não definida'}{event.rehearsal?.rehearsal_time ? ` · ${event.rehearsal.rehearsal_time.slice(0, 5)}` : ''}</span>{event.rehearsal?.rehearsal_place ? <span className="mt-1 block break-words text-xs text-muted-foreground">{event.rehearsal.rehearsal_place}</span> : null}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>{rehearsalError ? <div role="alert" className="p-3 text-sm"><p>{rehearsalError}</p><Button variant="outline" className="mt-2 min-h-11" onClick={onRetryRehearsals}>Carregar ensaios novamente</Button></div> : null}<ScheduleSaveStatus status={statuses[`rehearsal:${event.key}`]} /></div>
    </div>
    <footer className="flex justify-between gap-3 border-t p-4"><Button variant="outline" className="min-h-11" disabled={busy || !hasPrevious} onClick={() => onNavigate(-1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</Button><Button variant="outline" className="min-h-11" disabled={busy || !hasNext} onClick={() => onNavigate(1)}>Próximo<ChevronRight className="ml-1 h-4 w-4" /></Button></footer>
    <Dialog open={leaderOpen} onOpenChange={value => { if (!busy) setLeaderOpen(value) }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>Responsável pelo culto</DialogTitle><DialogDescription>Escolha entre integrantes ativos escalados para este culto. Essa pessoa poderá editar o ensaio.</DialogDescription></DialogHeader>
      <div className="space-y-1">{[{ id: '', name: 'Sem responsável' }, ...leaders].map(person => <Button key={person.id} variant="ghost" className="min-h-12 w-full justify-between whitespace-normal text-left" disabled={busy} onClick={() => void save(() => onSaveControl({ leaderMinisterId: person.id || null }), () => setLeaderOpen(false))}>{person.name}{(event.control?.leader_minister_id ?? '') === person.id ? <span className="ml-2 text-xs text-muted-foreground">Atual</span> : null}</Button>)}</div>
      {!leaders.length ? <p className="text-sm text-muted-foreground">Primeiro adicione integrantes à equipe.</p> : null}{localError ? <p role="alert" className="text-sm text-destructive">{localError}</p> : null}
    </DialogContent></Dialog>
    <Dialog open={rehearsalOpen} onOpenChange={value => { if (!busy) setRehearsalOpen(value) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>Ensaio do culto</DialogTitle><DialogDescription className="capitalize">{eventDateLabel(event.date)}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={formEvent => { formEvent.preventDefault(); void save(() => onSaveRehearsal({ rehearsal_date: date || null, rehearsal_time: time || null, rehearsal_place: place.trim() || null }), () => setRehearsalOpen(false)) }}>
        <div className="grid grid-cols-2 gap-3"><div className="min-w-0 space-y-2"><Label htmlFor="builder-rehearsal-date">Data</Label><Input id="builder-rehearsal-date" type="date" value={date} disabled={busy} onChange={e => setDate(e.target.value)} className="h-12 min-w-0 max-w-full text-base" /></div><div className="min-w-0 space-y-2"><Label htmlFor="builder-rehearsal-time">Horário</Label><Input id="builder-rehearsal-time" type="time" value={time} disabled={busy} onChange={e => setTime(e.target.value)} className="h-12 min-w-0 text-base" /></div></div>
        <div className="space-y-2"><Label htmlFor="builder-rehearsal-place">Local</Label><Input id="builder-rehearsal-place" value={place} maxLength={500} disabled={busy} onChange={e => setPlace(e.target.value)} placeholder="Ex.: auditório da igreja" className="h-12 text-base" /></div>
        {localError ? <p role="alert" className="text-sm text-destructive">{localError}</p> : null}<DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setRehearsalOpen(false)}>Voltar</Button><Button type="submit" className="min-h-11" disabled={busy}>{busy ? 'Salvando…' : 'Salvar ensaio'}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Dialog open={action !== null} onOpenChange={value => { if (!value && !busy) setAction(null) }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{action === 'cancel' ? 'Cancelar este culto?' : 'Reativar este culto?'}</DialogTitle><DialogDescription>{action === 'cancel' ? 'As atribuições e o histórico serão preservados. Os integrantes serão avisados e o evento será retirado dos calendários sincronizados.' : 'O culto voltará à escala. Os conflitos serão verificados, os integrantes serão avisados e os calendários sincronizados serão atualizados.'}</DialogDescription></DialogHeader>{localError ? <p role="alert" className="text-sm text-destructive">{localError}</p> : null}<DialogFooter><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setAction(null)}>Voltar</Button><Button variant={action === 'cancel' ? 'destructive' : 'default'} className="min-h-11" disabled={busy} onClick={() => { if (action) void save(() => onSaveControl({ action }), () => setAction(null)) }}>{busy ? 'Salvando…' : action === 'cancel' ? 'Cancelar culto' : 'Reativar culto'}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
