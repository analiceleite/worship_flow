 'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

export default function ResetPasswordClient({ token }: { token?: string | null }) {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [effectiveToken, setEffectiveToken] = useState<string | null>(token ?? null)

  useEffect(() => {
    console.log('[client /auth/reset] token prop=', token)
    // If token prop missing (some webviews strip params), try read from pathname
    if (!effectiveToken) {
      try {
        const p = typeof window !== 'undefined' ? window.location.pathname : ''
        const parts = p.split('/').filter(Boolean)
        const maybe = parts[parts.length - 1]
        if (maybe && maybe.length > 10) {
          setEffectiveToken(maybe)
        }
      } catch {
        // ignore
      }
    }

    // Don't treat a missing token as a fatal error immediately — wait for extraction.
    setChecking(false)
  }, [token, effectiveToken])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!password || !confirmPassword) {
      setError('Preencha todos os campos')
      return
    }

    if (password.length < 6) {
      setError('Mínimo 6 caracteres')
      return
    }

    if (password !== confirmPassword) {
      setError('Senhas não coincidem')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: effectiveToken, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erro ao redefinir senha')
        return
      }

      setSuccess(true)
      setTimeout(() => router.push('/auth/login'), 2000)
    } catch (err: any) {
      setError(err.message || 'Erro ao redefinir senha')
    } finally {
      setLoading(false)
    }
  }

  if (checking) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  )

  if (success) return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-bold text-foreground">Senha redefinida!</h1>
        <p className="mt-1 text-sm text-muted-foreground">Redirecionando para login...</p>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Redefina sua senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">Digite uma nova senha para sua conta.</p>
        </div>

        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!effectiveToken && !error && (
              <div className="text-sm text-muted-foreground">Aguardando token do link — verifique se abriu o link recebido por e-mail.</div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">Nova senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} minLength={6} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} minLength={6} />
            </div>

            <Button type="submit" className="w-full" disabled={loading || !effectiveToken}>
              {loading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Processando...
                </>
              ) : (
                'Redefinir senha'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
