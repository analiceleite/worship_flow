'use client'

import { useState } from 'react'
import { AlertTriangle, CalendarDays, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { BuilderPeriod } from '@/lib/schedule/builder-model'
import type { summarizeEvents } from '@/lib/schedule/builder-model'

export function PublishReview({ open, onOpenChange, period, previous, summary, busy, blockedReason, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; period: BuilderPeriod; previous?: string
  summary: ReturnType<typeof summarizeEvents>; busy: boolean; blockedReason: string | null
  onConfirm: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setError(null); onOpenChange(value) } }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{period.is_published ? 'Retirar a escala da publicação?' : 'Revisar publicação'}</DialogTitle><DialogDescription>{period.name} · {new Intl.DateTimeFormat('pt-BR').format(new Date(`${period.start_date}T12:00:00`))} a {new Intl.DateTimeFormat('pt-BR').format(new Date(`${period.end_date}T12:00:00`))}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm"><div><CalendarDays className="mb-2 h-4 w-4 text-muted-foreground" /><strong className="block text-xl tabular-nums">{summary.events}</strong>cultos ativos</div><div><Users className="mb-2 h-4 w-4 text-muted-foreground" /><strong className="block text-xl tabular-nums">{summary.filled}/{summary.total}</strong>funções preenchidas</div></div>
    {!period.is_published && (summary.total > summary.filled || summary.withoutLeader > 0) ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Avisos para conferir</p><ul className="list-inside list-disc space-y-1">{summary.total > summary.filled ? <li>{summary.total - summary.filled} funções ainda estão em aberto.</li> : null}{summary.withoutLeader ? <li>{summary.withoutLeader} cultos estão sem responsável.</li> : null}</ul><p className="mt-3 text-xs text-muted-foreground">São avisos, não bloqueios. Você pode publicar assim e completar depois.</p></div> : null}
    <div className="space-y-3 text-sm text-muted-foreground">
      {period.is_published ? <p>A escala voltará a ser um rascunho, visível apenas aos administradores. As pessoas afetadas serão avisadas e os eventos serão retirados dos calendários sincronizados.</p> : <><p>A equipe passará a consultar esta escala. Os integrantes escalados receberão avisos por e-mail, respeitando as preferências e configurações de envio, e os calendários conectados serão sincronizados.</p>{previous ? <p className="rounded-lg border p-3"><strong className="text-foreground">Atenção:</strong> o período <strong className="text-foreground">{previous}</strong> será despublicado, com aviso aos afetados e retirada dos eventos dos calendários.</p> : null}</>}
      {summary.cancelled ? <p>{summary.cancelled} cultos cancelados permanecem no histórico e não voltam à agenda com esta ação.</p> : null}
      <p>Falhas de envio ou sincronização não desfazem a operação; serão informadas para acompanhamento.</p>
    </div>
    {blockedReason || error ? <p role="alert" className="text-sm text-destructive">{blockedReason || error}</p> : null}
    <DialogFooter><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>Voltar e revisar</Button><Button className="min-h-11" variant={period.is_published ? 'destructive' : 'default'} disabled={busy || Boolean(blockedReason)} onClick={async () => { setError(null); try { await onConfirm(); onOpenChange(false) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a publicação.') } }}>{busy ? 'Atualizando…' : period.is_published ? 'Despublicar período' : 'Publicar escala'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
