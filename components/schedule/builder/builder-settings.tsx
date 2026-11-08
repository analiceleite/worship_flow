'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { selectedChurchFetch } from '@/lib/auth/client-context'

export function BuilderSettings({ open, onOpenChange, periodName, busy, onDelete }: {
  open: boolean; onOpenChange: (open: boolean) => void; periodName?: string; busy: boolean; onDelete: () => Promise<void>
}) {
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(null); setMessage(null); setConfirmDelete(false)
    selectedChurchFetch('/api/church/settings', { signal: controller.signal }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar as configurações.')
      if (!controller.signal.aborted) setTimezone(body.timezone)
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha ao carregar configurações.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, retry])
  return <Dialog open={open} onOpenChange={value => { if (!busy && !saving) onOpenChange(value) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Configurações da escala</DialogTitle><DialogDescription>Opções administrativas, fora do fluxo de montagem da equipe.</DialogDescription></DialogHeader>
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); setSaving(true); setError(null); setMessage(null)
      try {
        const response = await selectedChurchFetch('/api/church/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: timezone.trim() }) })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Não foi possível salvar o fuso.')
        setTimezone(body.timezone)
        setMessage(body.calendar_sync?.errors?.length ? 'Fuso salvo. Houve falha ao sincronizar calendários; confira a integração.' : 'Fuso da igreja atualizado.')
      } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') } finally { setSaving(false) }
    }}><Label htmlFor="builder-timezone">Fuso horário da igreja</Label><Input id="builder-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="America/Sao_Paulo" disabled={loading || saving || busy} className="h-12 text-base" /><p className="text-xs text-muted-foreground">Use um identificador IANA. Os horários são interpretados nesse fuso, inclusive nas integrações.</p><Button type="submit" variant="outline" className="min-h-11" disabled={!timezone.trim() || loading || saving || busy}>{loading ? 'Carregando…' : saving ? 'Salvando…' : 'Salvar fuso'}</Button></form>
    {message ? <p role="status" className="text-sm">{message}</p> : null}{error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!timezone && !loading ? <Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>Tentar novamente</Button> : null}</div> : null}
    {periodName ? <section className="mt-3 space-y-3 border-t pt-4"><h3 className="text-sm font-medium">Exclusão do período</h3><p className="break-words text-sm text-muted-foreground">{periodName}</p>{confirmDelete ? <><p className="text-sm text-destructive">A exclusão é irreversível e remove atribuições e ensaios. Para preservar o histórico, prefira despublicar o período ou cancelar o culto.</p><div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmDelete(false)}>Manter período</Button><Button variant="destructive" className="min-h-11" disabled={busy || saving} onClick={async () => { setError(null); try { await onDelete(); onOpenChange(false) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir.') } }}>{busy ? 'Excluindo…' : 'Confirmar exclusão'}</Button></div></> : <Button variant="outline" className="min-h-11 text-destructive" disabled={busy || saving} onClick={() => setConfirmDelete(true)}>Excluir período…</Button>}</section> : null}
    <DialogFooter><Button variant="ghost" className="min-h-11" disabled={busy || saving} onClick={() => onOpenChange(false)}>Fechar configurações</Button></DialogFooter>
  </DialogContent></Dialog>
}
