'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { CheckCircle2 } from 'lucide-react'

export default function SetPasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    const initializeSession = async () => {
      try {
        const supabase = createClient()

        // O middleware/auth.ts do Supabase já processou o ?code=... automaticamente
        // Aqui só precisamos verificar se existe uma sessão
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          setError('Link inválido ou expirado. Solicite um novo e-mail.')
          setChecking(false)
          return
        }

        // Sessão válida, pronto para redefinir
        setChecking(false)
      } catch (err: any) {
        setError('Erro ao processar link. Tente novamente.')
        setChecking(false)
      }
    }

    initializeSession()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validações
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
      const supabase = createClient()

      // Atualizar senha
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) throw updateError

      // Deslogar
      await supabase.auth.signOut()

      // Mostrar sucesso
      setSuccess(true)

      // Redirecionar após 2s
      setTimeout(() => {
        router.push(ROUTES.AUTH_LOGIN)
      }, 2000)
    } catch (err: any) {
      const msg = err?.message || 'Erro desconhecido'

      if (msg.includes('session')) {
        setError('Sessão expirada. Solicite novo e-mail.')
      } else if (msg.includes('password')) {
        setError('Erro na senha. Tente novamente.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  // Loading
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  // Success
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <CheckCircle2 className="h-7 w-7 text-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Senha redefinida!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Redirecionando para login...</p>
        </div>
      </div>
    )
  }

  // Form
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Redefina sua senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Digite uma nova senha para sua conta.
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
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Digite novamente"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
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

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Problemas?{' '}
          <a href={ROUTES.AUTH_FORGOT_PASSWORD} className="underline hover:text-foreground">
            Solicitar novo link
          </a>
        </p>
      </div>
    </div>
  )
}