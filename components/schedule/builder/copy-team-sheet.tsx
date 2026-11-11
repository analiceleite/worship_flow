'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { BuilderData, BuilderEvent } from '@/lib/schedule/builder-model'
import { planTeamCopy, rolesInSameEvent, type CopyItem, type CopyMode } from '@/lib/schedule/montar-escala'
import { eventDateLabel } from './schedule-event-list'

// Prévia e confirmação da cópia de equipe. Não salva nada: entrega os itens ao editor.
export function CopyTeamSheet({ open, onOpenChange, data, event, sources, busy, onApply }: {
  open: boolean; onOpenChange: (open: boolean) => void
  data: BuilderData; event: BuilderEvent; sources: BuilderEvent[]; busy: boolean
  onApply: (items: CopyItem[]) => Promise<void>
}) {
  const [sourceKey, setSourceKey] = useState<string | null>(null)
  const [mode, setMode] = useState<CopyMode>('empty')
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = sources.find(item => item.key === sourceKey) ?? null
  const preview = source ? planTeamCopy(source, event, mode) : null
  const items = preview ? [...preview.fill, ...preview.replace] : []
  const roleName = new Map(data.roles.map(role => [role.id, role.name]))
  const otherRoles = (item: CopyItem) => rolesInSameEvent(event, data.roles, item.ministerId, item.assignment.id)

  const finish = () => {
    setSourceKey(null); setMode('empty'); setError(null)
    onOpenChange(false)
  }
  const confirm = async () => {
    setCopying(true); setError(null)
    try {
      await onApply(items)
      setCopying(false)
      finish()
    } catch (err) {
      setCopying(false)
      setError(err instanceof Error ? err.message : 'Não foi possível copiar a equipe.')
    }
  }
  const locked = copying || busy

  return <Dialog open={open} onOpenChange={value => { if (value) onOpenChange(true); else if (!locked) finish() }}>
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Copiar equipe</DialogTitle>
        <DialogDescription className="capitalize">Para {eventDateLabel(event.date)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <p className="text-sm font-medium">De qual culto?</p>
        {sources.length ? <div role="group" aria-label="Culto de origem" className="grid gap-2">{sources.map(item => <Button key={item.key} variant={sourceKey === item.key ? 'secondary' : 'outline'} aria-pressed={sourceKey === item.key} disabled={locked} className="min-h-12 w-full justify-start whitespace-normal text-left capitalize" onClick={() => setSourceKey(item.key)}>
          {eventDateLabel(item.date)} · {item.type === 'sunday' ? 'Domingo' : 'Quinta'} <span className="ml-2 text-xs text-muted-foreground normal-case">{item.filled} de {item.total} funções</span>
        </Button>)}</div> : <p className="text-sm text-muted-foreground">Nenhum outro culto do período tem equipe preenchida.</p>}
      </div>

      {source ? <div className="space-y-2">
        <p className="text-sm font-medium">O que copiar?</p>
        <div role="group" aria-label="Modo da cópia" className="grid gap-2 sm:grid-cols-2">
          <Button variant={mode === 'empty' ? 'secondary' : 'outline'} aria-pressed={mode === 'empty'} disabled={locked} className="min-h-12" onClick={() => setMode('empty')}>Só vagas em aberto</Button>
          <Button variant={mode === 'replace' ? 'secondary' : 'outline'} aria-pressed={mode === 'replace'} disabled={locked} className="min-h-12" onClick={() => setMode('replace')}>Substituir tudo</Button>
        </div>
      </div> : null}

      {preview ? <div className="space-y-4 rounded-lg border p-3 text-sm">
        <section aria-label="Vagas que serão preenchidas">
          <h3 className="font-medium">Vai preencher ({preview.fill.length})</h3>
          {preview.fill.length ? <ul className="mt-1 space-y-1">{preview.fill.map(item => <li key={item.assignment.id}>{roleName.get(item.assignment.role_id)}: {item.ministerName}{item.isTrainee ? ' (aprendiz)' : ''}{otherRoles(item).length ? <span className="block text-xs text-amber-800 dark:text-amber-300">Já está como {otherRoles(item).join(', ')} neste culto</span> : null}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Nenhuma vaga em aberto receberá alguém.</p>}
        </section>
        {mode === 'replace' ? <section aria-label="Vagas que serão substituídas">
          <h3 className="font-medium">Vai substituir ({preview.replace.length})</h3>
          {preview.replace.length ? <ul className="mt-1 space-y-1">{preview.replace.map(item => <li key={item.assignment.id}>{roleName.get(item.assignment.role_id)}: {item.assignment.minister?.name ?? 'Sem pessoa'} → {item.ministerName}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Nenhuma vaga preenchida com pessoa diferente.</p>}
        </section> : null}
        <p className="text-muted-foreground">Mantém {preview.keep.length} {preview.keep.length === 1 ? 'vaga' : 'vagas'} sem alteração.</p>
      </div> : null}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button variant="outline" className="min-h-11" disabled={locked} onClick={finish}>Cancelar</Button>
        <Button className="min-h-11" disabled={!items.length || locked} onClick={() => void confirm()}>
          {copying ? 'Copiando…' : mode === 'replace' ? `Substituir ${items.length} ${items.length === 1 ? 'vaga' : 'vagas'}` : `Copiar ${items.length} ${items.length === 1 ? 'vaga' : 'vagas'}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
