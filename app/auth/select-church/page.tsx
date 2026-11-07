'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/routes'
import type { MembershipCandidate } from '@/lib/auth/membership'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type OwnMembership = MembershipCandidate & { church_name: string }

function stateLabel(membership: OwnMembership): string {
  if (membership.church_status !== 'active') return 'Igreja indisponível. Entre em contato com o responsável.'
  if (membership.access_state === 'suspended') return 'Acesso suspenso nesta igreja. Entre em contato com o administrador.'
  if (membership.access_state === 'pending') return 'Acesso pendente. Conclua a entrada pelo link do convite recebido.'
  return membership.role === 'admin' ? 'Administrador' : membership.role === 'midia' ? 'Mídia' : 'Integrante'
}

export default function SelectChurchPage() {
  const [memberships, setMemberships] = useState<OwnMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const response = await fetch('/api/me/memberships', { cache: 'no-store', signal: controller.signal })
        if (response.status === 401) { window.location.replace(ROUTES.AUTH_LOGIN); return }
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Não foi possível consultar suas igrejas.')
        if (!controller.signal.aborted) setMemberships(result.memberships)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível consultar suas igrejas.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [attempt])

  async function select(churchId: string) {
    if (selecting) return
    setSelecting(churchId)
    setError(null)
    try {
      const response = await fetch('/api/context', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ churchId }),
      })
      if (response.status === 401) { window.location.replace(ROUTES.AUTH_LOGIN); return }
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível selecionar a igreja.')
      // Full navigation discards tenant-bound UI/cache state from the previous environment.
      window.location.assign(result.redirectTo)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível selecionar a igreja.')
      setSelecting(null)
    }
  }

  async function signOut() {
    if (selecting) return
    setSelecting('logout')
    try {
      const { error } = await createClient().auth.signOut()
      if (error) throw error
      window.location.replace(ROUTES.AUTH_LOGIN)
    } catch {
      setError('Não foi possível sair. Tente novamente.')
      setSelecting(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle><h1>Escolha sua igreja</h1></CardTitle>
          <CardDescription>Uma conta, participações independentes. Entre em uma igreja com acesso ativo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4" aria-busy={loading || Boolean(selecting)}>
          {loading ? <p role="status">Consultando suas igrejas...</p> : null}
          {error ? <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert> : null}
          {!loading && !error && memberships.length === 0 ? (
            <p>Você ainda não participa de uma igreja. Peça um convite ao administrador ou abra o link que recebeu.</p>
          ) : null}
          {!loading ? memberships.map(membership => {
            const active = membership.access_state === 'active' && membership.church_status === 'active'
            return (
              <div key={membership.id} className="space-y-2 rounded-lg border p-4">
                <h2 className="font-semibold">{membership.church_name}</h2>
                <p className="text-sm text-muted-foreground">{stateLabel(membership)}</p>
                {active ? <Button className="min-h-11" disabled={Boolean(selecting)} onClick={() => void select(membership.church_id)}>
                  {selecting === membership.church_id ? 'Entrando...' : `Entrar em ${membership.church_name}`}
                </Button> : null}
              </div>
            )
          }) : null}
          {!loading && error ? <Button variant="outline" disabled={Boolean(selecting)} onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button> : null}
          <Button variant="ghost" className="min-h-11" disabled={Boolean(selecting)} onClick={() => void signOut()}>Sair da conta</Button>
        </CardContent>
      </Card>
    </main>
  )
}
