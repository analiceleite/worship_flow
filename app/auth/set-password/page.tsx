'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  })

  useEffect(() => {
    checkUserStatus()
  }, [])

  const checkUserStatus = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/auth/login')
        return
      }

      // Get minister record
      const { data: minister, error: ministerError } = await supabase
        .from('ministers')
        .select('name, is_active')
        .eq('user_id', user.id)
        .single()

      if (ministerError) {
        throw new Error('Usuário não encontrado')
      }

      if (minister.is_active) {
        // Already activated, redirect to home
        router.push('/')
        return
      }

      setUserName(minister.name)
    } catch (err: any) {
      console.error('Error checking user:', err)
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
      
      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: formData.password,
      })

      if (updateError) throw updateError

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) throw new Error('Usuário não encontrado')

      // Mark minister as active
      const { error: activateError } = await supabase
        .from('ministers')
        .update({ is_active: true })
        .eq('user_id', user.id)

      if (activateError) throw activateError

      setSuccess(true)

      // Redirect after 2 seconds
      setTimeout(() => {
        router.push('/')
        router.refresh()
      }, 2000)
    } catch (err: any) {
      console.error('Set password error:', err)
      setError(err.message || 'Erro ao definir senha. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl font-bold">Senha Definida!</CardTitle>
            <CardDescription>
              Sua conta foi ativada com sucesso. Redirecionando...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Bem-vindo, {userName}!</CardTitle>
          <CardDescription>
            Defina sua senha para ativar sua conta no Worship Flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetPassword} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Nova Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                required
                disabled={loading}
                minLength={6}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Digite a senha novamente"
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
                required
                disabled={loading}
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              Ativar Conta
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
