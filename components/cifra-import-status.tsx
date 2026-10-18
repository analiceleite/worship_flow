'use client'
import Link from 'next/link'
import type { ImportSnapshot } from '@/lib/cifra/import-controller'
import { Button } from '@/components/ui/button'

const messages: Record<ImportSnapshot['phase'], string> = {
  idle: '', starting: 'Iniciando serviço de importação; você pode continuar usando o sistema.',
  queued: 'Aguardando capacidade para importar a cifra.', extracting: 'Obtendo cifra da fonte.', validating: 'Conferindo a cifra importada.',
  ready: 'Cifra importada. Revise o rascunho antes de salvar.', failed: 'Não foi possível importar a cifra.',
  expired: 'A importação expirou. Você pode tentar novamente.', cancelled: 'Importação cancelada.',
}
export function CifraImportStatus({ snapshot, onCancel, onDiscard }: { snapshot: ImportSnapshot; onCancel(): void; onDiscard(): void }) {
  if (snapshot.phase === 'idle') return null
  const busy = ['starting', 'queued', 'extracting', 'validating'].includes(snapshot.phase)
  return <aside className="fixed bottom-4 left-4 right-4 z-40 rounded-md border bg-background p-3 shadow-md sm:left-auto sm:w-96" aria-label="Importação de cifra">
    <p role="status" aria-live="polite" className="text-sm">{snapshot.error?.message || messages[snapshot.phase]}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button asChild variant="outline" className="min-h-11"><Link href="/songs?reviewImport=1">{busy ? 'Acompanhar importação' : 'Revisar cifra'}</Link></Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={busy ? onCancel : onDiscard}>{busy ? 'Cancelar importação' : 'Descartar rascunho'}</Button>
    </div>
  </aside>
}
