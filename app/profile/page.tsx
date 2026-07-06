'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { Bell, CalendarCheck } from 'lucide-react'

const ALARM_OPTIONS = [
  { value: 1440, label: '1 dia antes' },
  { value: 720, label: '12 horas antes' },
  { value: 60, label: '1 hora antes' },
  { value: 30, label: '30 minutos antes' },
]

const EMAIL_REMINDER_OPTIONS = [
  { value: 10080, label: '7 dias antes' },
  { value: 1440, label: '1 dia antes' },
  { value: 720, label: '12 horas antes' },
  { value: 60, label: '1 hora antes' },
  { value: 30, label: '30 minutos antes' },
]

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [minister, setMinister] = useState<any>(null)
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true)
  const [selectedAlarms, setSelectedAlarms] = useState<number[]>([720, 60])
  const [selectedEmailReminders, setSelectedEmailReminders] = useState<number[]>([10080, 1440])
  const [saving, setSaving] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; connectedAt: string | null; syncedEventCount: number } | null>(null)
  const [googleActionLoading, setGoogleActionLoading] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }
      setUser(user)

      const { data } = await supabase
        .from('ministers')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setMinister(data)
        setEmailRemindersEnabled(data.email_reminders_enabled ?? true)
        setSelectedAlarms(data.calendar_alarm_offsets_minutes || [720, 60])
        setSelectedEmailReminders(data.email_reminder_offsets_minutes || [10080, 1440])
      }
      setLoading(false)
    }

    checkAuth()
  }, [supabase, router])

  useEffect(() => {
    fetch('/api/google-calendar/status')
      .then((r) => r.json())
      .then(setGoogleStatus)
      .catch(() => {})

    const params = new URLSearchParams(window.location.search)
    const gcal = params.get('google_calendar')
    if (gcal) {
      const messages: Record<string, string> = {
        connected: 'Google Calendar conectado com sucesso!',
        denied: 'Conexão cancelada.',
        error: 'Erro ao conectar com o Google. Tente novamente.',
        no_refresh_token: 'Não foi possível concluir a conexão. Revogue o acesso do app na sua Conta Google e tente novamente.',
      }
      if (messages[gcal]) {
        if (gcal === 'connected') {
          toast.success(messages[gcal])
        } else {
          toast.error(messages[gcal])
        }
      }
      router.replace('/profile')
    }
  }, [router])

  const handleDisconnectGoogle = async () => {
    setGoogleActionLoading(true)
    try {
      const res = await fetch('/api/google-calendar/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      toast.success('Google Calendar desconectado.')
      setGoogleStatus({ connected: false, connectedAt: null, syncedEventCount: 0 })
    } catch (error) {
      toast.error('Erro ao desconectar.')
    } finally {
      setGoogleActionLoading(false)
    }
  }

  const handleAlarmToggle = (value: number) => {
    setSelectedAlarms(prev =>
      prev.includes(value)
        ? prev.filter(v => v !== value)
        : [...prev, value]
    )
  }

  const handleEmailReminderToggle = (value: number) => {
    setSelectedEmailReminders(prev =>
      prev.includes(value)
        ? prev.filter(v => v !== value)
        : [...prev, value]
    )
  }

  const handleSavePreferences = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendar_alarm_offsets_minutes: selectedAlarms,
          email_reminders_enabled: emailRemindersEnabled,
          email_reminder_offsets_minutes: selectedEmailReminders,
        }),
      })

      if (!response.ok) throw new Error('Failed to save preferences')

      toast.success('Preferências salvas com sucesso!')

      // Refresh minister data
      const { data } = await supabase
        .from('ministers')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setMinister(data)
      }
    } catch (error) {
      toast.error('Erro ao salvar preferências')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-4">Carregando...</div>
  }

  if (!minister) {
    return <div className="p-4">Ministro não encontrado</div>
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Meu Perfil</h1>
          <p className="mt-2 text-sm text-muted-foreground">Configurar minhas preferências de notificação e calendário</p>
        </div>

        <div className="space-y-6">
          {/* Google Calendar Connection Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck className="w-5 h-5" />
                Google Calendar
              </CardTitle>
              <CardDescription>
                Cria eventos reais na sua agenda do Google, com alarmes que funcionam de verdade no celular.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {googleStatus?.connected ? (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Conectado</p>
                      <p className="text-xs text-muted-foreground">
                        {googleStatus.syncedEventCount} evento(s) sincronizado(s)
                        {googleStatus.connectedAt ? ` · desde ${new Date(googleStatus.connectedAt).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDisconnectGoogle} disabled={googleActionLoading}>
                      Desconectar
                    </Button>
                  </div>
                </>
              ) : (
                <Button asChild className="w-full" size="lg">
                  <a href="/api/google-calendar/connect">Conectar com Google</a>
                </Button>
              )}

              <div className="border-t border-border pt-4">
                <Label className="text-base font-medium mb-3 block">Lembretes</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Escolha quantas vezes ser lembrado antes da escala:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                  {ALARM_OPTIONS.map(option => (
                    <div key={option.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`alarm-${option.value}`}
                        checked={selectedAlarms.includes(option.value)}
                        onCheckedChange={() => handleAlarmToggle(option.value)}
                      />
                      <Label htmlFor={`alarm-${option.value}`} className="cursor-pointer text-sm">
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Email Notifications Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notificações por email
              </CardTitle>
              <CardDescription>
                Controle quais notificações você deseja receber
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <Label className="text-sm font-medium block mb-1">Receber lembretes de escala</Label>
                  <p className="text-xs text-muted-foreground">
                    {emailRemindersEnabled
                      ? 'Você receberá emails nas antecedências escolhidas abaixo. Funciona em qualquer app, independente do Google Calendar.'
                      : 'Você não receberá lembretes por email'}
                  </p>
                </div>
                <Switch
                  checked={emailRemindersEnabled}
                  onCheckedChange={setEmailRemindersEnabled}
                />
              </div>

              {emailRemindersEnabled && (
                <div className="border-t border-border pt-4">
                  <Label className="text-sm font-medium mb-3 block">Quando enviar os lembretes por email</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                    {EMAIL_REMINDER_OPTIONS.map(option => (
                      <div key={option.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`email-reminder-${option.value}`}
                          checked={selectedEmailReminders.includes(option.value)}
                          onCheckedChange={() => handleEmailReminderToggle(option.value)}
                        />
                        <Label htmlFor={`email-reminder-${option.value}`} className="cursor-pointer text-sm">
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="pt-2">
            <Button
              onClick={handleSavePreferences}
              disabled={saving}
              className="w-full sm:w-auto"
              size="lg"
            >
              {saving ? 'Salvando...' : 'Salvar Preferências'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
