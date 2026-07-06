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
import { Copy, RotateCcw, Calendar, Bell } from 'lucide-react'

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
  const [calendarFeedEnabled, setCalendarFeedEnabled] = useState(true)
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true)
  const [selectedAlarms, setSelectedAlarms] = useState<number[]>([720, 60])
  const [selectedEmailReminders, setSelectedEmailReminders] = useState<number[]>([10080, 1440])
  const [saving, setSaving] = useState(false)

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
        setCalendarFeedEnabled(data.calendar_feed_enabled ?? true)
        setEmailRemindersEnabled(data.email_reminders_enabled ?? true)
        setSelectedAlarms(data.calendar_alarm_offsets_minutes || [720, 60])
        setSelectedEmailReminders(data.email_reminder_offsets_minutes || [10080, 1440])
      }
      setLoading(false)
    }

    checkAuth()
  }, [supabase, router])

  const handleGenerateToken = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/calendar/token', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to generate token')

      const { https_url } = await response.json()

      // Copy https link to clipboard (works with Google Calendar's "From URL" and manual subscription flows)
      await navigator.clipboard.writeText(https_url)
      toast.success('Link copiado para área de transferência!')

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
      toast.error('Erro ao gerar link')
    } finally {
      setSaving(false)
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
      const response = await fetch('/api/calendar/token', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendar_alarm_offsets_minutes: selectedAlarms,
          calendar_feed_enabled: calendarFeedEnabled,
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

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const httpsUrl = minister.calendar_token
    ? `${baseUrl}/api/calendar/${minister.calendar_token}`
    : ''

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
          {/* Calendar Subscription Card */}
          <Card>
            <CardHeader>
              <CardTitle>Assinar minha escala</CardTitle>
              <CardDescription>
                Adicione sua escala automaticamente no Apple Calendar ou Google Calendar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!minister.calendar_token ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Gere um link único para assinar sua escala. Este link será válido indefinidamente até que você o regenere.
                  </p>
                  <Button
                    onClick={handleGenerateToken}
                    disabled={saving}
                    className="w-full"
                    size="lg"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Gerar Link de Assinatura
                  </Button>
                </>
              ) : (
                <>
                  <div className="bg-muted/50 p-4 rounded-lg space-y-4 border border-border">
                    <div>
                      <p className="text-sm font-medium mb-2 text-foreground">Link da assinatura:</p>
                      <div className="flex gap-2 flex-col sm:flex-row">
                        <code className="flex-1 bg-background p-3 rounded border border-border text-xs overflow-x-auto break-all font-mono text-muted-foreground">
                          {httpsUrl}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(httpsUrl)
                            toast.success('Link copiado!')
                          }}
                          className="sm:w-auto w-full"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-sm space-y-2 border-t border-border pt-4">
                      <p className="font-medium text-foreground">Como adicionar:</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
                        <li><strong>macOS (Calendário):</strong> Calendário → Arquivo → Nova Assinatura de Calendário → colar o link</li>
                        <li><strong>iOS:</strong> Ajustes → Calendário → Contas → Adicionar Conta → Outra → Adicionar Assinatura de Calendário → colar o link</li>
                        <li><strong>Google Calendar (web ou Android):</strong> Outras agendas (+) → &quot;Por URL&quot; → colar o link acima</li>
                      </ul>
                    </div>
                  </div>

                  <Button
                    onClick={handleGenerateToken}
                    disabled={saving}
                    variant="outline"
                    className="w-full"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Regenerar Link
                  </Button>

                  {/* Alarms Section */}
                  <div className="border-t border-border pt-4 space-y-4">
                    <div>
                      <Label className="text-base font-medium mb-3 block">Alarmes do calendário</Label>
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
                      <div className="mt-3 rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-muted-foreground space-y-1">
                        <p>
                          <strong>Apple Calendar (iOS/macOS):</strong> os alarmes acima são aplicados automaticamente
                          em cada evento assim que você assina o calendário.
                        </p>
                        <p>
                          <strong>Google Calendar:</strong> os alarmes acima <strong>não funcionam</strong> — o Google
                          ignora os alertas vindos do feed e usa este calendário só para visualização. Para ser
                          avisado lá, configure manualmente uma vez: abra o calendário assinado no Google Calendar →
                          menu (⋮) → &quot;Configurações e compartilhamento&quot; → &quot;Notificações de eventos&quot;
                          → escolha uma antecedência (vale para todos os eventos futuros deste calendário).
                        </p>
                        <p>
                          Por isso, para garantir o aviso independente do app que você usa, mantenha os{' '}
                          <strong>lembretes por e-mail</strong> abaixo ativados.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Toggle Calendar Feed */}
                  <div className="border-t border-border pt-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <Label className="text-sm font-medium block mb-1">Ativar integração com calendário</Label>
                        <p className="text-xs text-muted-foreground">
                          {calendarFeedEnabled
                            ? 'Seu calendário receberá as atualizações da escala'
                            : 'Você não receberá eventos no calendário'}
                        </p>
                      </div>
                      <Switch
                        checked={calendarFeedEnabled}
                        onCheckedChange={setCalendarFeedEnabled}
                      />
                    </div>
                  </div>
                </>
              )}
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
                    ? 'Você receberá emails nas antecedências escolhidas abaixo. Funciona em qualquer app, independente do calendário assinado.'
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
