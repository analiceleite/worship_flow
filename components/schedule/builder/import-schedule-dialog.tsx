'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { selectedChurchFetch } from '@/lib/auth/client-context'

interface PreviewItem {
  id: string; assignment_id: string | null; event_date: string | null; event_type: string; role_name: string
  raw_minister_name: string; message: string; status: string; current_minister_id: string | null
  matched_ministers: Array<{ id: string; name: string }>
}
interface Preview { items: PreviewItem[]; ministers: Array<{ id: string; name: string }> }
export interface ImportItem { assignment_id: string; minister_id: string; is_trainee: boolean }

export function ImportScheduleDialog({ open, onOpenChange, quarterId, busy, onApply }: {
  open: boolean; onOpenChange: (open: boolean) => void; quarterId: string; busy: boolean
  onApply: (items: ImportItem[]) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const analyze = async () => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      const workbook = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = () => reject(new Error('Não foi possível ler a planilha.'))
        reader.readAsDataURL(file)
      })
      const response = await selectedChurchFetch(`/api/schedule/quarters/${quarterId}/import/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workbook_base64: workbook }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível analisar a planilha.')
      const next = body as Preview
      setPreview(next)
      setSelection(Object.fromEntries(next.items.filter(item => item.assignment_id).map(item => [item.id,
        item.status === 'ready' && item.matched_ministers.length === 1 ? item.matched_ministers[0].id : '',
      ])))
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao analisar a planilha.') }
    finally { setLoading(false) }
  }
  const items = (preview?.items ?? []).filter(item => item.assignment_id && selection[item.id]
    && selection[item.id] !== item.current_minister_id).map(item => ({ assignment_id: item.assignment_id!, minister_id: selection[item.id], is_trainee: false }))
  const pending = (preview?.items ?? []).filter(item => item.assignment_id && item.status !== 'ready' && !selection[item.id]).length
  return <Dialog open={open} onOpenChange={value => { if (!busy && !loading) onOpenChange(value) }}><DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
    <DialogHeader><DialogTitle>Importar planilha</DialogTitle><DialogDescription>Escolha o arquivo, confira os nomes e aplique somente as correspondências desejadas. Nenhuma mudança é feita ao gerar a prévia.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto p-1">
      <div className="space-y-2"><Label htmlFor="builder-import-file">Planilha (.xlsx ou .xls)</Label><Input id="builder-import-file" type="file" accept=".xlsx,.xls" disabled={busy || loading} className="min-h-11" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null) }} /></div>
      <Button variant="outline" className="min-h-11 w-full" disabled={!file || busy || loading} onClick={() => void analyze()}>{loading ? 'Analisando…' : 'Gerar prévia'}</Button>
      {preview ? <><p className="text-sm text-muted-foreground">{preview.items.length} itens encontrados · {items.length} alterações selecionadas{pending ? ` · ${pending} correspondências precisam de atenção` : ''}</p><div className="space-y-3">{preview.items.map(item => <div key={item.id} className="space-y-2 rounded-lg border p-3"><p className="text-sm font-medium">{item.event_date ?? 'Data inválida'} · {item.event_type === 'thursday' ? 'Quinta' : 'Domingo'} · {item.role_name}</p><p className="break-words text-sm">Planilha: {item.raw_minister_name}</p><p className="text-xs text-muted-foreground">{item.message}</p>{item.assignment_id ? <label className="block text-xs text-muted-foreground">Integrante correspondente<select className="mt-1 min-h-12 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={selection[item.id] ?? ''} disabled={busy} onChange={e => setSelection(current => ({ ...current, [item.id]: e.target.value }))}><option value="">Não aplicar esta atribuição</option>{preview.ministers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : null}</div>)}</div></> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="outline" className="min-h-11" disabled={busy || loading} onClick={() => onOpenChange(false)}>Voltar</Button><Button className="min-h-11" disabled={!items.length || busy || loading} onClick={async () => { setError(null); try { await onApply(items); onOpenChange(false) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível importar.') } }}>{busy ? 'Aplicando…' : `Aplicar ${items.length} alterações`}</Button></DialogFooter>
  </DialogContent></Dialog>
}
