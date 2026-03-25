'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { CheckCircle2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ROUTES } from '@/lib/routes'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email) {
      setError('Digite seu e-mail')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erro ao enviar e-mail')
        return
      }

      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar e-mail')
    } finally {
      setLoading(false)
    }
  }

  // Success state
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <CheckCircle2 className="h-7 w-7 text-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">E-mail enviado!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Verifique sua caixa de entrada e clique no link para redefinir sua senha.
          </p>
          <Link href={ROUTES.AUTH_LOGIN} className="mt-4 inline-block">
            <Button variant="outline" className="w-full">
              Voltar ao login
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  // Form
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <Link href={ROUTES.AUTH_LOGIN} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <div className="mb-8 mt-6">
          <h1 className="text-2xl font-bold text-foreground">Esqueceu a senha?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Digite seu e-mail e enviaremos um link para redefinir sua senha.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Enviando...
                </>
              ) : (
                'Enviar link de redefinição'
              )}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Lembrou a senha?{' '}
          <Link href={ROUTES.AUTH_LOGIN} className="underline hover:text-foreground">
            Fazer login
          </Link>
        </p>
      </div>
    </div>
  )
}