'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInThroughServer } from '@/lib/auth/login-client'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({ email: '', password: '' })

  useEffect(() => { setReady(true) }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await signInThroughServer(formData.email, formData.password)

      const response = await fetch('/api/context', { cache: 'no-store' })
      if (response.status === 403 || response.status === 409) {
        router.push(ROUTES.AUTH_SELECT_CHURCH)
        router.refresh()
        return
      }
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar seu acesso. Tente novamente.')
      router.push(result.context.role === 'admin' ? ROUTES.USERS : ROUTES.HOME)
      router.refresh()
    } catch (err: any) {
      console.error('Login error:', err)
      setError(err.message || 'Erro ao fazer login. Verifique suas credenciais.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">

        {/* ── Logo + title ── */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
            <img src="/logo.jpg" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Worship Flow</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com suas credenciais para continuar
          </p>
        </div>

        {/* ── Form ── */}
        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading || !ready}>
              {loading && (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              )}
              Entrar
            </Button>
            <div className="mt-2 text-center">
              <a
                href={ROUTES.AUTH_FORGOT_PASSWORD}
                className="text-xs text-primary underline hover:text-primary/80"
              >
                Esqueceu a senha?
              </a>
            </div>
          </form>
          {process.env.NEXT_PUBLIC_WF38_PUBLIC_CHURCH_CREATION === 'true' && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Quer começar sua própria igreja?{' '}
              <a href={ROUTES.AUTH_CRIAR_IGREJA} className="text-primary underline hover:text-primary/80">
                Criar ambiente da minha igreja
              </a>
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
