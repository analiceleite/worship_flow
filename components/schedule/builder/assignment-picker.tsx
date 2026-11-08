'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { UserAvatar } from '@/components/user-avatar'
import { useIsMobile } from '@/hooks/use-mobile'
import { selectedChurchFetch } from '@/lib/auth/client-context'
import type { AssignmentMinister, ScheduleAssignment, ScheduleRole } from '@/components/schedule/ScheduleGrid'

export type SaveAssignment = (assignment: ScheduleAssignment, minister: AssignmentMinister | null, trainee: boolean) => Promise<void>

export function AssignmentPicker({ assignment, role, eventLabel, disabled, onSave }: {
  assignment: ScheduleAssignment; role: ScheduleRole; eventLabel: string; disabled: boolean; onSave: SaveAssignment
}) {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Array<AssignmentMinister & { email?: string | null }>>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [trainee, setTrainee] = useState(assignment.is_trainee)
  const [attempt, setAttempt] = useState<{ minister: AssignmentMinister | null; trainee: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setSearchError(null)
    const timer = setTimeout(async () => {
      try {
        const roleParam = role.category === 'midia' ? '&role=midia' : ''
        const response = await selectedChurchFetch(`/api/ministers/search?query=${encodeURIComponent(query)}&limit=25${roleParam}`, { signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Não foi possível buscar integrantes.')
        if (!controller.signal.aborted) setOptions(body.ministers ?? [])
      } catch (error) {
        if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Falha na busca.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 220)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, query, retry, role.category])

  const pick = async (minister: AssignmentMinister | null, isTrainee = trainee) => {
    setSaving(true)
    setSaveError(null)
    setAttempt({ minister, trainee: isTrainee })
    try {
      await onSave(assignment, minister, minister ? isTrainee : false)
      setOpen(false)
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar.') }
    finally { setSaving(false) }
  }
  const setOpened = (value: boolean) => {
    if (saving) return
    if (value) { setTrainee(assignment.is_trainee); setSaveError(null); setAttempt(null); setQuery('') }
    setOpen(value)
  }
  const contents = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar pelo nome" aria-label={`Buscar integrante para ${role.name}`} className="h-12 pl-10 text-base" disabled={saving} />
      </div>
      <div className="min-h-32 flex-1 overflow-y-auto overscroll-contain" aria-busy={loading || saving}>
        {loading ? <div className="space-y-2" aria-label="Buscando integrantes">{[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
          : searchError ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm"><p>{searchError}</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => setRetry(value => value + 1)}>Tentar busca novamente</Button></div>
          : options.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum integrante encontrado. Tente outro nome.</p>
          : <ul className="space-y-1">{options.map(option => (
            <li key={option.id}>
              <button type="button" disabled={saving || disabled} onClick={() => void pick(option)} className="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                <UserAvatar name={option.name} avatarUrl={option.avatar_url} className="h-10 w-10 shrink-0" />
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{option.name}</span>
                  {options.some(other => other.id !== option.id && other.name === option.name) && option.email ? <span className="block break-all text-xs text-muted-foreground">{option.email}</span> : null}
                  {assignment.minister_id === option.id ? <span className="block text-xs text-muted-foreground">Escalado nesta função</span> : null}
                </span>
                {assignment.minister_id === option.id ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}</ul>}
      </div>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 border-t pt-3 text-sm">
        <Checkbox checked={trainee} onCheckedChange={value => setTrainee(value === true)} disabled={saving} />
        <span>Aprendiz neste culto<span className="block text-xs text-muted-foreground">Não altera as permissões da pessoa.</span></span>
      </label>
      {saveError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>{saveError}</p>{attempt ? <Button variant="outline" className="mt-2 min-h-11" disabled={saving || disabled} onClick={() => void pick(attempt.minister, attempt.trainee)}>Tentar novamente</Button> : null}</div> : null}
      <div className="grid gap-2 border-t pt-3 pb-[env(safe-area-inset-bottom)]">
        {assignment.minister && trainee !== assignment.is_trainee ? <Button className="min-h-11" disabled={saving || disabled} onClick={() => void pick(assignment.minister)}>Salvar participação</Button> : null}
        {assignment.minister_id ? <Button variant="ghost" className="min-h-11 justify-start text-muted-foreground" disabled={saving || disabled} onClick={() => void pick(null)}><X className="mr-2 h-4 w-4" />Deixar função em aberto</Button> : null}
        {saving ? <p role="status" className="flex items-center justify-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Salvando participação…</p> : null}
      </div>
    </div>
  )
  return (
    <>
      <button type="button" onClick={() => setOpened(true)} disabled={disabled || saving}
        aria-label={`${role.name}: ${assignment.minister?.name ?? 'adicionar integrante'}`}
        className="flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        {assignment.minister ? <UserAvatar name={assignment.minister.name} avatarUrl={assignment.minister.avatar_url} className="h-10 w-10 shrink-0" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground"><Plus className="h-4 w-4" /></span>}
        <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{role.name}</span><span className="block break-words text-sm font-medium">{assignment.minister?.name ?? 'Adicionar integrante'}</span></span>
        {assignment.is_trainee && assignment.minister_id ? <span className="rounded-md bg-muted px-2 py-1 text-xs">Aprendiz</span> : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {mobile ? <Sheet open={open} onOpenChange={setOpened}><SheetContent side="bottom" className="flex max-h-[92dvh] flex-col rounded-t-2xl p-4 motion-reduce:animate-none motion-reduce:transition-none [&>button:last-child]:flex [&>button:last-child]:size-11 [&>button:last-child]:items-center [&>button:last-child]:justify-center [&>button:last-child]:right-1 [&>button:last-child]:top-1">
        <SheetHeader className="px-0 pb-1 pr-8"><SheetTitle>Quem vai assumir {role.name.toLowerCase()}?</SheetTitle><SheetDescription>{eventLabel}. Toque no nome para salvar.</SheetDescription></SheetHeader>{contents}
      </SheetContent></Sheet> : <Dialog open={open} onOpenChange={setOpened}><DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader><DialogTitle>Escolher integrante · {role.name}</DialogTitle><DialogDescription>{eventLabel}. Selecione uma pessoa para salvar.</DialogDescription></DialogHeader>{contents}
      </DialogContent></Dialog>}
    </>
  )
}
