'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { ROUTES } from '@/lib/routes'

export default function ResetPasswordClient({ legacy = false }: { legacy?: boolean }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [tokenHash, setTokenHash] = useState<string | null>(null)
  const initialized = useRef(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token_hash')
    // Keep proof only in component memory, not in history or persistent storage.
    window.history.replaceState(null, '', ROUTES.AUTH_RESET)
    if (!legacy && value && /^[a-zA-Z0-9_-]{40,128}$/.test(value)) setTokenHash(value)
    else setError('Link inválido ou antigo. Solicite um novo link para redefinir sua senha.')
    setChecking(false)
  }, [legacy])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !tokenHash) return
    setError(null)
    if (password.length < 6 || password.length > 128) {
      setError('Use uma senha de 6 a 128 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    submitting.current = true
    setLoading(true)
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash, password }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Não foi possível redefinir a senha. Solicite um novo link.')
        if (response.status === 400) setTokenHash(null)
        return
      }
      setTokenHash(null)
      setPassword('')
      setConfirmPassword('')
      setSuccess(true)
    } catch {
      setError('Não foi possível confirmar a alteração. Tente entrar com a nova senha ou solicite outro link.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  if (checking) return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Verificando link">
      <Spinner className="h-8 w-8" />
    </div>
  )

  if (success) return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-bold text-foreground">Senha redefinida!</h1>
        <p role="status" className="mt-2 text-sm text-muted-foreground">Entre na sua conta com a nova senha.</p>
        <Button asChild className="mt-6 min-h-11 w-full"><Link href={ROUTES.AUTH_LOGIN}>Voltar ao login</Link></Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Redefina sua senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">Escolha uma nova senha para sua conta.</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
            {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
            {tokenHash && <>
              <div className="space-y-1.5">
                <Label htmlFor="password">Nova senha</Label>
                <Input id="password" type="password" autoComplete="new-password" required minLength={6} maxLength={128}
                  className="min-h-11" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} aria-describedby="password-hint" />
                <p id="password-hint" className="text-xs text-muted-foreground">Use de 6 a 128 caracteres. A política da sua conta também será aplicada.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirmar senha</Label>
                <Input id="confirmPassword" type="password" autoComplete="new-password" required minLength={6} maxLength={128}
                  className="min-h-11" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} />
              </div>
              <Button type="submit" className="min-h-11 w-full" disabled={loading}>
                {loading ? <><Spinner className="mr-2 h-4 w-4" />Processando...</> : 'Redefinir senha'}
              </Button>
            </>}
          </form>
        </div>
        <Link href={ROUTES.AUTH_FORGOT_PASSWORD} className="mt-4 flex min-h-11 items-center justify-center text-sm underline underline-offset-4">
          Solicitar novo link
        </Link>
      </div>
    </div>
  )
}
