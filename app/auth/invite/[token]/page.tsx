'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { signInThroughServer } from '@/lib/auth/login-client'
import { ROUTES } from '@/lib/routes'
import type { InvitationInspection } from '@/lib/invitations/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

type Mode = 'signup' | 'login'

function roleLabel(role: InvitationInspection['role']): string {
  return role === 'admin' ? 'Administrador' : role === 'midia' ? 'Mídia' : 'Integrante'
}

export default function InvitePage() {
  const params = useParams<{ token: string }>()
  const token = useMemo(() => (typeof params?.token === 'string' ? params.token : ''), [params])
  const [inspection, setInspection] = useState<InvitationInspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('signup')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [signupForm, setSignupForm] = useState({ name: '', password: '' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })

  const inspect = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setUnavailable(null)
    setError(null)
    try {
      const response = await fetch('/api/invitations/inspect', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setUnavailable(data.error || 'Este convite não está mais disponível.')
        return
      }
      const invitation = data.invitation as InvitationInspection
      setInspection(invitation)
      setSignupForm(current => ({ ...current, name: current.name || invitation.name }))
    } catch {
      setUnavailable('Não foi possível verificar este convite. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void inspect() }, [inspect])

  const enter = () => { window.location.assign('/') }

  const accept = async () => {
    const response = await fetch('/api/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Não foi possível aceitar o convite.')
    enter()
  }

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/invitations/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: signupForm.name, password: signupForm.password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Não foi possível criar sua conta.')
      const { error: resendError } = await createClient().auth.resend({ type: 'signup', email: data.email })
      if (resendError) throw new Error('Conta criada, mas não foi possível enviar o e-mail de confirmação. Tente entrar em alguns minutos.')
      setLoginForm({ email: data.email, password: '' })
      setMode('login')
      setNotice(`Enviamos um e-mail de confirmação para ${data.email}. Confirme a conta e depois entre aqui para aceitar o convite.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar sua conta.')
    } finally {
      setBusy(false)
    }
  }

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await signInThroughServer(loginForm.email, loginForm.password)
      await accept()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  const handleAccept = async () => {
    setBusy(true)
    setError(null)
    try {
      await accept()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível aceitar o convite.')
    } finally {
      setBusy(false)
    }
  }

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    } catch {
      return value
    }
  }

  const state = inspection?.state
  const usable = state === 'pending'
  const sessionState = inspection?.session_state ?? 'anonymous'
  const hasSession = sessionState !== 'anonymous'

  const leaveAccount = async () => {
    setBusy(true)
    setError(null)
    try {
      await createClient().auth.signOut()
      await inspect()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
            <img src="/logo.jpg" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Worship Flow</h1>
          <p className="mt-1 text-sm text-muted-foreground">Convite para participar de uma igreja</p>
        </div>

        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6" /></div>
          ) : unavailable ? (
            <div className="space-y-4 text-center">
              <MailWarning className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{unavailable}</p>
              <Button asChild variant="outline" className="w-full"><Link href={ROUTES.AUTH_LOGIN}>Ir para o login</Link></Button>
            </div>
          ) : inspection && !usable ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">
                {state === 'accepted' ? 'Convite já aceito' : state === 'expired' ? 'Convite expirado' : 'Convite revogado'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {state === 'accepted'
                  ? `Este convite para ${inspection.church_name} já foi utilizado.`
                  : state === 'expired'
                    ? `Este convite para ${inspection.church_name} expirou. Peça um novo convite ao administrador.`
                    : `Este convite para ${inspection.church_name} foi revogado pelo administrador.`}
              </p>
              {hasSession ? (
                <Button className="w-full" onClick={enter}>Ir para o sistema</Button>
              ) : (
                <Button asChild variant="outline" className="w-full"><Link href={ROUTES.AUTH_LOGIN}>Entrar</Link></Button>
              )}
            </div>
          ) : inspection ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Igreja</p>
                <p className="text-base font-semibold text-foreground">{inspection.church_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {roleLabel(inspection.role)}
                  {inspection.role !== 'midia' && inspection.instrument ? ` · ${inspection.instrument}` : ''}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Enviado para {inspection.email_hint} · válido até {formatDate(inspection.expires_at)}
                </p>
              </div>

              {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
              {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}

              {sessionState === 'mismatched' ? (
                <div className="space-y-3">
                  <Alert variant="destructive">
                    <AlertDescription role="alert">
                      Você está conectado como outra conta. Saia desta conta e entre com o e-mail que recebeu o convite ({inspection.email_hint}).
                    </AlertDescription>
                  </Alert>
                  <Button className="w-full" onClick={() => void leaveAccount()} disabled={busy}>
                    {busy && <Spinner className="mr-2" />}
                    Sair desta conta
                  </Button>
                </div>
              ) : sessionState === 'matching' ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Você já está conectado com o e-mail do convite. Aceite para entrar em {inspection.church_name}.
                  </p>
                  <Button className="w-full" onClick={() => void handleAccept()} disabled={busy}>
                    {busy && <Spinner className="mr-2" />}
                    Aceitar convite
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={mode === 'signup' ? 'default' : 'outline'} size="sm" onClick={() => setMode('signup')} disabled={busy}>Criar minha conta</Button>
                    <Button type="button" variant={mode === 'login' ? 'default' : 'outline'} size="sm" onClick={() => setMode('login')} disabled={busy}>Já tenho conta</Button>
                  </div>

                  {mode === 'signup' ? (
                    <form onSubmit={handleSignup} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-name">Seu nome</Label>
                        <Input
                          id="invite-name"
                          value={signupForm.name}
                          onChange={event => setSignupForm({ ...signupForm, name: event.target.value })}
                          required
                          maxLength={200}
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-password">Crie uma senha</Label>
                        <Input
                          id="invite-password"
                          type="password"
                          autoComplete="new-password"
                          value={signupForm.password}
                          onChange={event => setSignupForm({ ...signupForm, password: event.target.value })}
                          required
                          minLength={6}
                          maxLength={128}
                          disabled={busy}
                        />
                        <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres.</p>
                      </div>
                      <Button type="submit" className="w-full" disabled={busy}>
                        {busy && <Spinner className="mr-2" />}
                        Criar conta e aceitar
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleLogin} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-email">E-mail da conta</Label>
                        <Input
                          id="invite-email"
                          type="email"
                          autoComplete="email"
                          value={loginForm.email}
                          onChange={event => setLoginForm({ ...loginForm, email: event.target.value })}
                          required
                          disabled={busy}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-login-password">Senha</Label>
                        <Input
                          id="invite-login-password"
                          type="password"
                          autoComplete="current-password"
                          value={loginForm.password}
                          onChange={event => setLoginForm({ ...loginForm, password: event.target.value })}
                          required
                          disabled={busy}
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={busy}>
                        {busy && <Spinner className="mr-2" />}
                        Entrar e aceitar
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Use a conta que recebeu este convite ({inspection.email_hint}). O aceite confirma que o e-mail corresponde.
                      </p>
                    </form>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
