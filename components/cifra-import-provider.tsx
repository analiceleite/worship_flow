'use client'

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createImportController, type ImportController, type ImportSnapshot } from '@/lib/cifra/import-controller'
import type { ImportScope } from '@/lib/cifra/contract'
import { CifraImportStatus } from './cifra-import-status'

type Value = { controller: ImportController; snapshot: ImportSnapshot; scope: ImportScope | null; available: boolean; validated: boolean }
const Context = createContext<Value | null>(null)
export const useCifraImport = () => useContext(Context)

export function CifraImportProvider({ children }: { children: React.ReactNode }) {
  const [controller] = useState(() => createImportController())
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [scope, setScope] = useState<ImportScope | null>(null)
  const [available, setAvailable] = useState(false)
  const [validated, setValidated] = useState(false)
  const pathname = usePathname()
  const reset = useCallback(() => { controller.resetScope(null); setScope(null); setAvailable(false); setValidated(false) }, [controller])

  useEffect(() => {
    const abort = new AbortController()
    const excluded = /^\/(auth|platform)(\/|$)/.test(pathname || '') || pathname === '/'
    const load = async () => {
      setValidated(false)
      if (excluded) { reset(); return }
      try {
        const response = await fetch('/api/context', { cache: 'no-store', signal: abort.signal })
        if (!response.ok) throw Error('CONTEXT_UNAVAILABLE')
        const value = await response.json()
        if (abort.signal.aborted) return
        const next = value.context?.userId && value.context?.churchId ? { userId: value.context.userId, churchId: value.context.churchId } : null
        controller.resetScope(next); setScope(next)
        setAvailable(Boolean(next && value.features?.cifraImportV2)); setValidated(Boolean(next))
      } catch { if (!abort.signal.aborted) { setValidated(false); setAvailable(false) } }
    }
    void load()
    window.addEventListener('focus', load)
    return () => { abort.abort(); window.removeEventListener('focus', load) }
  }, [pathname, controller, reset])

  useEffect(() => {
    const subscription = createClient().auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') reset() }).data.subscription
    window.addEventListener('wf:cifra-context-reset', reset)
    return () => { subscription.unsubscribe(); window.removeEventListener('wf:cifra-context-reset', reset); controller.dispose() }
  }, [controller, reset])

  return <Context.Provider value={{ controller, snapshot, scope, available, validated }}>
    {children}
    {available && validated ? <CifraImportStatus snapshot={snapshot} onCancel={() => void controller.cancel()} onDiscard={() => controller.discard()} /> : null}
  </Context.Provider>
}
