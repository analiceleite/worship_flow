'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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
  const [userName, setUserName] = useState<string>('')
  const [formData, setFormData] = useState({ password: '', confirmPassword: '' })

  useEffect(() => { checkUserStatus() }, [])

  const checkUserStatus = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) { router.push('/auth/login'); return }

      const { data: minister, error: ministerError } = await supabase
        .from('ministers')
        .select('name, is_active')
        .eq('user_id', user.id)
        .single()

      if (ministerError) throw new Error('Usuário não encontrado')
      if (minister.is_active) { router.push('/'); return }

      setUserName(minister.name)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setChecking(false)
    }
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem')
      return
    }
    if (formData.password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()

      const { error: updateError } = await supabase.auth.updateUser({ password: formData.password })
      if (updateError) throw updateError

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não encontrado')

      const { error: activateError } = await supabase
        .from('ministers')
        .update({ is_active: true })
        .eq('user_id', user.id)
      if (activateError) throw activateError

      setSuccess(true)
      setTimeout(() => { router.push('/'); router.refresh() }, 2000)
    } catch (err: any) {
      setError(err.message || 'Erro ao definir senha. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // ── Loading check ──
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  // ── Success state ──
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <CheckCircle2 className="h-7 w-7 text-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Conta ativada!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua senha foi definida. Redirecionando...
          </p>
        </div>
      </div>
    )
  }

  // ── Form ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">

        {/* ── Header ── */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            Bem-vindo, {userName}!
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Defina sua senha para ativar sua conta no Worship Flow.
          </p>
        </div>

        {/* ── Form card ── */}
        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <form onSubmit={handleSetPassword} className="space-y-4">
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
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={loading}
                minLength={6}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Digite a senha novamente"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                disabled={loading}
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              Ativar conta
            </Button>
          </form>
        </div>

      </div>
    </div>
  )
}