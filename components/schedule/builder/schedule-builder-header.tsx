'use client'

import Link from 'next/link'
import { ArrowLeft, MoreHorizontal, Plus, Settings2, FileSpreadsheet, BarChart3, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ROUTES } from '@/lib/routes'
import type { BuilderPeriod } from '@/lib/schedule/builder-model'

export function ScheduleBuilderHeader({ periods, selectedId, loading, busy, onSelect, onCreate, onImport, onSettings }: {
  periods: BuilderPeriod[]; selectedId: string; loading: boolean; busy: boolean
  onSelect: (id: string) => void; onCreate: () => void; onImport: () => void; onSettings: () => void
}) {
  const period = periods.find(item => item.id === selectedId)
  return <header className="space-y-4">
    <nav aria-label="Navegação estrutural" className="flex items-center gap-2 text-xs text-muted-foreground"><Link href={ROUTES.SCHEDULE} className="inline-flex min-h-11 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-3.5 w-3.5" />Escala</Link><span aria-hidden="true">/</span><span aria-current="page">Montar escala</span></nav>
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Montar escala</h1><p className="mt-1 text-sm text-muted-foreground">Um culto de cada vez. Tudo no seu lugar.</p></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="Mais opções da escala" variant="outline" size="icon" className="h-11 w-11 shrink-0" disabled={busy}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onCreate} className="min-h-11"><Plus className="mr-2 h-4 w-4" />Novo período</DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport} disabled={!period} className="min-h-11"><FileSpreadsheet className="mr-2 h-4 w-4" />Importar planilha</DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings} className="min-h-11"><Settings2 className="mr-2 h-4 w-4" />Configurações</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11"><Link href={ROUTES.SCHEDULE_ADMIN_QUARTERS}><ListFilter className="mr-2 h-4 w-4" />Todos os períodos</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11"><Link href={ROUTES.SCHEDULE_ADMIN_DASHBOARD}><BarChart3 className="mr-2 h-4 w-4" />Dashboard</Link></DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>
    {periods.length || loading ? <div className="rounded-xl border bg-card p-4"><label className="block text-xs font-medium text-muted-foreground" htmlFor="builder-period">Período da escala</label><select id="builder-period" value={selectedId} onChange={event => onSelect(event.target.value)} disabled={loading || busy} className="mt-1 min-h-12 w-full min-w-0 rounded-md border-0 bg-transparent pr-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {loading ? <option value="">Carregando períodos…</option> : null}
      {!loading && selectedId && !period ? <option value={selectedId}>Período não encontrado</option> : null}
      {periods.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_published ? ' · Publicado' : ' · Rascunho'}</option>)}
    </select>{period ? <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${period.is_published ? 'bg-primary' : 'bg-muted-foreground'}`} aria-hidden="true" />{period.is_published ? 'Publicada para a equipe. Alterações são salvas e podem gerar avisos.' : 'Rascunho · Apenas administradores podem ver este período.'}</p> : null}</div> : null}
  </header>
}
