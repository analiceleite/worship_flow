'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/routes'
import { CHURCH_OWNER_PASSWORD_MIN } from '@/lib/onboarding/rules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

type Mode = 'loading' | 'signup' | 'login' | 'create' | 'unverified'

export default function CriarIgrejaPage() {
  const [mode, setMode] = useState<Mode>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [churchName, setChurchName] = useState('')
  const [createdChurch, setCreatedChurch] = useState(false)
  // Retries of the same intention reuse the key, so a timeout cannot create a second church.
  const attemptRef = useRef<{ name: string; key: string } | null>(null)

  useEffect(() => {
    let active = true
    createClient().auth.getUser().then(({ data }) => {
      if (!active) return
      if (!data.user) return setMode('signup')
      setMode(data.user.email_confirmed_at ? 'create' : 'unverified')
    })
    return () => { active = false }
  }, [])

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/onboarding/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Não foi possível criar sua conta.')
      // The same answer for new and existing e-mails: the confirmation request is sent either way.
      const { error: resendError } = await createClient().auth.resend({ type: 'signup', email: signupForm.email })
      if (resendError) throw new Error('Não foi possível enviar o e-mail de confirmação agora. Tente novamente em alguns minutos.')
      setLoginForm({ email: signupForm.email, password: '' })
      setMode('login')
      setNotice(`Enviamos um e-mail de confirmação para ${signupForm.email}. Confirme sua conta e depois entre aqui para criar sua igreja.`)
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
      const { data, error: signInError } = await createClient().auth.signInWithPassword(loginForm)
      if (signInError) {
        throw new Error('E-mail ou senha inválidos, ou a conta ainda não foi confirmada.')
      }
      setMode(data.user?.email_confirmed_at ? 'create' : 'unverified')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateChurch = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const name = churchName.trim()
      if (!attemptRef.current || attemptRef.current.name !== name) {
        attemptRef.current = { name, key: crypto.randomUUID() }
      }
      const response = await fetch('/api/onboarding/church', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, idempotencyKey: attemptRef.current.key }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Não foi possível criar a igreja agora.')
      attemptRef.current = null
      setCreatedChurch(true)
      window.location.assign(ROUTES.SCHEDULE_ADMIN_DASHBOARD)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar a igreja agora.')
    } finally {
      setBusy(false)
    }
  }

  const resendConfirmation = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await createClient().auth.getUser()
      if (!data.user?.email) throw new Error('Entre novamente para reenviar a confirmação.')
      const { error: resendError } = await createClient().auth.resend({ type: 'signup', email: data.user.email })
      if (resendError) throw new Error('Não foi possível reenviar agora. Tente novamente em alguns minutos.')
      setNotice('Reenviamos o e-mail de confirmação. Verifique também a caixa de spam.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível reenviar agora.')
    } finally {
      setBusy(false)
    }
  }

  if (process.env.NEXT_PUBLIC_WF38_PUBLIC_CHURCH_CREATION !== 'true') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-3 rounded-xl border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Criação de igreja indisponível</h1>
          <p className="text-sm text-muted-foreground">
            Por enquanto, sua igreja é criada pela equipe da plataforma. Fale com quem te convidou.
          </p>
          <Link href={ROUTES.AUTH_LOGIN} className="text-sm underline">Voltar para o login</Link>
        </div>
      </div>
    )
  }

  if (mode === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Criar ambiente da minha igreja</h1>
          <p className="text-sm text-muted-foreground">
            Você será o primeiro administrador. Ninguém precisa criar nada para você.
          </p>
        </header>

        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}

        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Seu nome</Label>
              <Input id="owner-name" value={signupForm.name} required maxLength={200} disabled={busy}
                onChange={event => setSignupForm({ ...signupForm, name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">E-mail</Label>
              <Input id="owner-email" type="email" autoComplete="email" value={signupForm.email} required disabled={busy}
                onChange={event => setSignupForm({ ...signupForm, email: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-password">Crie uma senha</Label>
              <Input id="owner-password" type="password" autoComplete="new-password" value={signupForm.password}
                required minLength={CHURCH_OWNER_PASSWORD_MIN} maxLength={128} disabled={busy}
                onChange={event => setSignupForm({ ...signupForm, password: event.target.value })} />
              <p className="text-xs text-muted-foreground">Mínimo de {CHURCH_OWNER_PASSWORD_MIN} caracteres.</p>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Spinner className="mr-2" />}
              Criar minha conta
            </Button>
            <p className="text-center text-sm">
              <button type="button" className="underline" onClick={() => setMode('login')} disabled={busy}>
                Já tenho conta
              </button>
            </p>
          </form>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="owner-login-email">E-mail</Label>
              <Input id="owner-login-email" type="email" autoComplete="email" value={loginForm.email} required disabled={busy}
                onChange={event => setLoginForm({ ...loginForm, email: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-login-password">Senha</Label>
              <Input id="owner-login-password" type="password" autoComplete="current-password" value={loginForm.password} required disabled={busy}
                onChange={event => setLoginForm({ ...loginForm, password: event.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Spinner className="mr-2" />}
              Entrar
            </Button>
          </form>
        )}

        {mode === 'unverified' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirme o e-mail da sua conta para criar a igreja. Abra a mensagem que enviamos e depois entre de novo.
            </p>
            <Button variant="outline" className="w-full" onClick={() => void resendConfirmation()} disabled={busy}>
              Reenviar e-mail de confirmação
            </Button>
          </div>
        )}

        {mode === 'create' && !createdChurch && (
          <form onSubmit={handleCreateChurch} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="church-name">Nome da igreja</Label>
              <Input id="church-name" value={churchName} required minLength={2} maxLength={120} disabled={busy}
                onChange={event => setChurchName(event.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Spinner className="mr-2" />}
              Criar ambiente da igreja
            </Button>
            <p className="text-xs text-muted-foreground">
              Cada conta pode criar uma igreja. Participar de outras igrejas por convite não depende disso.
            </p>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <Link href={ROUTES.AUTH_LOGIN} className="underline">Voltar para o login</Link>
        </p>
      </div>
    </div>
  )
}
