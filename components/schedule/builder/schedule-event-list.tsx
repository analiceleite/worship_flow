'use client'

import { Check, ChevronRight, CircleDashed, Users } from 'lucide-react'
import type { BuilderEvent, BuilderPeriod } from '@/lib/schedule/builder-model'
import { eventTime } from '@/lib/schedule/builder-model'

export function eventDateLabel(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))
}

export function ScheduleEventList({ events, period, selectedKey, onOpen }: {
  events: BuilderEvent[]; period: BuilderPeriod; selectedKey: string | null; onOpen: (event: BuilderEvent) => void
}) {
  let month = ''
  return <div className="space-y-2">{events.map(event => {
    const eventMonth = event.date.slice(0, 7)
    const heading = eventMonth !== month
    month = eventMonth
    const date = new Date(`${event.date}T12:00:00`)
    const complete = event.filled === event.total
    return <div key={event.key}>
      {heading ? <h2 className="px-1 pb-2 pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date)}</h2> : null}
      <button type="button" onClick={() => onOpen(event)} aria-pressed={selectedKey === event.key}
        className={`group flex w-full gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedKey === event.key ? 'border-primary/50 bg-primary/5' : 'border-border'} ${event.cancelled ? 'opacity-70' : ''}`}>
        <span className="flex w-12 shrink-0 flex-col items-center justify-start border-r pr-3 pt-0.5"><span className="text-[11px] font-medium uppercase text-muted-foreground">{event.type === 'sunday' ? 'Dom' : 'Qui'}</span><span className="text-2xl font-semibold tabular-nums tracking-tight">{date.getDate().toString().padStart(2, '0')}</span></span>
        <span className="min-w-0 flex-1 space-y-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold">Culto · {eventTime(period, event.type, 'service')}</span>{event.cancelled ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Cancelado</span> : null}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{complete ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}{event.cancelled ? 'Histórico preservado' : complete ? 'Equipe preenchida' : `${event.filled} de ${event.total} funções preenchidas`}</span>
          {!event.cancelled && event.missing.length ? <span className="block text-xs text-amber-800 dark:text-amber-300">Em aberto: {event.missing.slice(0, 2).join(', ')}{event.missing.length > 2 ? ` e mais ${event.missing.length - 2}` : ''}</span> : null}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{event.control?.leader?.name ? `Responsável: ${event.control.leader.name}` : 'Responsável não definido'}</span></span>
        </span>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  })}</div>
}
