'use client'

import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SaveState {
  state: 'saving' | 'saved' | 'error'
  message?: string
  retry?: () => Promise<unknown>
}

export function ScheduleSaveStatus({ status }: { status?: SaveState }) {
  if (!status) return null
  if (status.state === 'saving') return <p role="status" className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Salvando…</p>
  if (status.state === 'saved') return <p role="status" className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground"><Check className="h-3 w-3" />Salvo</p>
  return <div role="alert" className="mx-2 mb-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm"><p>{status.message}</p>{status.retry ? <Button type="button" size="sm" variant="outline" className="mt-2 min-h-11" onClick={() => void status.retry?.().catch(() => {})}><RotateCcw className="mr-2 h-3.5 w-3.5" />Tentar novamente</Button> : null}</div>
}
