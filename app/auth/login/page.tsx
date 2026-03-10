'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({ email: '', password: '' })

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      })

      if (signInError) throw signInError

      const { data: minister, error: ministerError } = await supabase
        .from('ministers')
        .select('role, is_active')
        .eq('user_id', data.user.id)
        .single()

      if (ministerError) {
        throw new Error('Usuário não está cadastrado como ministro')
      }

      if (!minister.is_active) {
        router.push('/auth/set-password')
        return
      }

      router.push(minister.role === 'admin' ? '/ministros' : '/')
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              )}
              Entrar
            </Button>
          </form>
        </div>

      </div>
    </div>
  )
}