'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { scheduleMutationFetch } from '@/lib/schedule/client-mutation'

export function useScheduleMutation() {
  const [message, setMessage] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const resolve = useRef<((reason: string | null) => void) | null>(null)
  useEffect(() => () => { resolve.current?.(null) }, [])
  const requestReason = useCallback((error: string) => new Promise<string | null>(done => {
    // Never overwrite an outstanding confirmation from another operation.
    if (resolve.current) { done(null); return }
    resolve.current = done
    setReason('')
    setMessage(error)
  }), [])
  const finish = (value: string | null) => {
    resolve.current?.(value)
    resolve.current = null
    setMessage(null)
  }
  const request = useCallback((url: string, init: RequestInit, allowOverride = true) =>
    scheduleMutationFetch(url, init, allowOverride, requestReason), [requestReason])
  const conflictDialog = (
    <Dialog open={message !== null} onOpenChange={open => { if (!open) finish(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conflito de horário</DialogTitle>
          <DialogDescription>{message} Você pode voltar e ajustar a escala ou autorizar uma exceção como administrador.</DialogDescription>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (reason.trim()) finish(reason.trim()) }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-override-reason">Por que esta exceção é necessária?</Label>
            <Textarea id="schedule-override-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required rows={3} />
            <p className="text-xs text-muted-foreground">A justificativa e o administrador responsável ficam registrados.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => finish(null)}>Voltar e ajustar</Button>
            <Button type="submit" className="min-h-11" disabled={!reason.trim()}>Autorizar exceção</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
  return { request, conflictDialog }
}
