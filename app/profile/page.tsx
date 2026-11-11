'use client'

import { PAGE_WIDTH } from '@/lib/page-layout'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Checkbox } from '@/components/ui/checkbox'
import { ThemeToggle } from '@/components/theme-toggle'
import { ProfilePhoto } from '@/components/profile-photo'
import { ProfileName } from '@/components/profile-name'
import { UserAvatar } from '@/components/user-avatar'
import { toast } from 'sonner'
import { Bell, CalendarCheck } from 'lucide-react'
import { getAppVersion } from '@/lib/release-notes'
import { churchFetch, loadChurchContext, loadSelectedMinister } from '@/lib/auth/client-context'

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

type GoogleCalendarStatus = {
  connected: boolean
  connectedAt: string | null
  syncEnabled: boolean
  syncedEventCount: number
  connectedChurchCount: number
}

export default function ProfilePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [minister, setMinister] = useState<any>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true)
  const [optionalPaused, setOptionalPaused] = useState(false)
  const [selectedAlarms, setSelectedAlarms] = useState<number[]>([720, 60])
  const [selectedEmailReminders, setSelectedEmailReminders] = useState<number[]>([10080, 1440])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveBusy = useRef(false)
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null)
  const [googleActionLoading, setGoogleActionLoading] = useState(false)
  const [globalPreferencesError, setGlobalPreferencesError] = useState<string | null>(null)
  const [globalPreferencesLoading, setGlobalPreferencesLoading] = useState(true)
  const [globalPreferencesLoaded, setGlobalPreferencesLoaded] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(true)

  const loadGlobalPreferences = useCallback(async (churchId: string) => {
    setGlobalPreferencesLoading(true)
    setGlobalPreferencesError(null)
    try {
      const response = await churchFetch(churchId, '/api/profile')
      if (!response.ok) throw new Error('Profile unavailable')
      const { profile } = await response.json()
      if (typeof profile?.optional_notifications_paused !== 'boolean') throw new Error('Invalid profile')
      setOptionalPaused(profile.optional_notifications_paused)
      setGlobalPreferencesLoaded(true)
    } catch {
      setGlobalPreferencesLoaded(false)
      setGlobalPreferencesError('Não foi possível consultar a pausa global. Ela não será alterada ao salvar as preferências locais.')
    } finally {
      setGlobalPreferencesLoading(false)
    }
  }, [])

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setContextError(null)
    try {
      const { context } = await loadChurchContext()
      const data = await loadSelectedMinister(context)
      if (!data) throw new Error('Perfil local indisponível neste contexto de suporte.')
      setMinister(data)
      setEmailRemindersEnabled(data.email_reminders_enabled ?? true)
      setSelectedAlarms(data.calendar_alarm_offsets_minutes || [720, 60])
      setSelectedEmailReminders(data.email_reminder_offsets_minutes || [10080, 1440])

      await loadGlobalPreferences(data.church_id)
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Não foi possível consultar seu perfil.')
    } finally {
      setLoading(false)
    }
  }, [loadGlobalPreferences])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const loadGoogleStatus = useCallback(async (churchId: string) => {
    setGoogleLoading(true)
    setGoogleError(null)
    try {
      const response = await churchFetch(churchId, '/api/google-calendar/status')
      if (!response.ok) throw new Error('Status unavailable')
      const status = await response.json()
      if (typeof status.connected !== 'boolean') throw new Error('Invalid status')
      setGoogleStatus(status)
    } catch {
      setGoogleError('Não foi possível consultar o Google Calendar. O estado da conexão é desconhecido.')
    } finally {
      setGoogleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (minister?.church_id) void loadGoogleStatus(minister.church_id)
  }, [minister?.church_id, loadGoogleStatus])

  useEffect(() => {
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
      params.delete('google_calendar')
      const remaining = params.toString()
      router.replace(remaining ? `/profile?${remaining}` : '/profile')
    }
  }, [router])

  const handleDisconnectGoogle = async () => {
    if (googleActionLoading) return
    setGoogleActionLoading(true)
    try {
      if (!minister) throw new Error('Não foi possível identificar a igreja atual.')
      const res = await churchFetch(minister.church_id, '/api/google-calendar/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'account' }),
      })
      if (!res.ok) throw new Error('Failed to disconnect')
      toast.success('Conta Google desconectada.')
      await loadGoogleStatus(minister.church_id)
    } catch {
      toast.error('Erro ao desconectar.')
    } finally {
      setGoogleActionLoading(false)
    }
  }

  const handleChurchSyncToggle = async (enabled: boolean) => {
    if (googleActionLoading) return
    setGoogleActionLoading(true)
    try {
      if (!minister) throw new Error('Não foi possível identificar a igreja atual.')
      const res = await churchFetch(minister.church_id, '/api/google-calendar/sync-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Failed to update sync selection')
      toast.success(enabled ? 'Sincronização desta igreja ativada.' : 'Sincronização desta igreja parada.')
      await loadGoogleStatus(minister.church_id)
    } catch {
      toast.error('Erro ao atualizar a sincronização.')
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
    if (saveBusy.current) return
    saveBusy.current = true
    setSaving(true)
    setSaveError(null)
    try {
      if (!minister) throw new Error('Não foi possível identificar a igreja atual.')
      const response = await churchFetch(minister.church_id, '/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendar_alarm_offsets_minutes: selectedAlarms,
          email_reminders_enabled: emailRemindersEnabled,
          email_reminder_offsets_minutes: selectedEmailReminders,
          ...(globalPreferencesLoaded ? { optional_notifications_paused: optionalPaused } : {}),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Não foi possível salvar as preferências. Tente novamente.')
      }

      toast.success('Preferências salvas com sucesso!')

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar as preferências. Tente novamente.'
      setSaveError(message)
      toast.error(message)
    } finally {
      saveBusy.current = false
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-4">Carregando...</div>
  }

  if (!minister) {
    return (
      <main className={`${PAGE_WIDTH} py-6`}>
        <ErrorState
          title="Não foi possível consultar seu perfil"
          message={contextError ?? 'Sua participação nesta igreja está indisponível.'}
          onRetry={() => void loadProfile()}
          retrying={loading}
        />
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-background">

      <main className={`${PAGE_WIDTH} py-6`}>
        {/* Header Section */}
        <div className="mb-6 flex items-center gap-4">
          <UserAvatar name={minister.name} avatarUrl={minister.avatar_url} className="h-20 w-20 text-5xl" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Meu Perfil</h1>
            <p className="mt-1 break-words font-medium">{minister.name}</p>
            <p className="text-sm text-muted-foreground">{minister.role === 'admin' ? 'Administrador' : minister.role === 'midia' ? 'Mídia' : 'Ministro'}{minister.instrument ? ` · ${minister.instrument}` : ''}</p>
            <p className="mt-2 text-sm text-muted-foreground">Configurar minhas preferências de aparência, notificação e calendário</p>
          </div>
        </div>

        <div className="space-y-6">
          <ProfileName name={minister.name} onSaved={name => setMinister((current: any) => ({ ...current, name }))} />
          <ProfilePhoto
            name={minister.name}
            avatarUrl={minister.avatar_url}
            onSaved={avatarUrl => setMinister((current: any) => ({ ...current, avatar_url: avatarUrl }))}
          />
          <Card>
            <CardHeader>
              <CardTitle>Aparência</CardTitle>
              <CardDescription>Personalize a aparência da plataforma neste dispositivo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Tema claro ou escuro</p>
                  <p className="text-xs text-muted-foreground">A alteração é aplicada e salva automaticamente.</p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>

          {/* Google Calendar Connection Card */}
          <Card>
            <CardHeader>
              <CardTitle>Sobre o Worship Flow</CardTitle>
              <CardDescription>Versão em execução</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{getAppVersion() ? `Versão ${getAppVersion()}` : 'Versão não informada neste ambiente'}</p>
            </CardContent>
          </Card>

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
              {googleLoading ? (
                <p role="status">Consultando Google Calendar…</p>
              ) : googleError ? (
                <ErrorState title="Google Calendar indisponível" message={googleError}
                  onRetry={() => void loadGoogleStatus(minister.church_id)} />
              ) : googleStatus?.connected ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {googleStatus.syncEnabled ? 'Sincronizado nesta igreja' : 'Conta Google conectada'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {googleStatus.syncEnabled
                            ? `${googleStatus.syncedEventCount} evento(s) sincronizado(s) nesta igreja`
                            : 'Esta igreja ainda não envia eventos para a sua agenda.'}
                          {googleStatus.connectedAt ? ` · desde ${new Date(googleStatus.connectedAt).toLocaleDateString('pt-BR')}` : ''}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleChurchSyncToggle(!googleStatus.syncEnabled)} disabled={googleActionLoading}>
                        {googleStatus.syncEnabled ? 'Parar sincronização desta igreja' : 'Sincronizar esta igreja'}
                      </Button>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDisconnectGoogle} disabled={googleActionLoading}>
                    Desconectar conta Google
                  </Button>
                </div>
              ) : (
                <Button asChild className="w-full" size="lg">
                  <a href={`/api/google-calendar/connect?churchId=${encodeURIComponent(minister.church_id)}`}>Conectar com Google</a>
                </Button>
              )}

              <div className="border-t border-border pt-4">
                <Label className="text-base font-medium mb-3 block">Lembretes</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Escolha quantas vezes ser lembrado antes da escala:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                  {ALARM_OPTIONS.map(option => (
                    <div key={option.value} className="flex min-h-11 items-center gap-3">
                      <Checkbox
                        id={`alarm-${option.value}`}
                        checked={selectedAlarms.includes(option.value)}
                        onCheckedChange={() => handleAlarmToggle(option.value)}
                      />
                      <Label htmlFor={`alarm-${option.value}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm">
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
                  <Label htmlFor="email-reminders-enabled" className="text-sm font-medium block mb-1">Receber lembretes de escala</Label>
                  <p id="email-reminders-description" className="text-xs text-muted-foreground">
                    {emailRemindersEnabled
                      ? 'Você receberá emails nas antecedências escolhidas abaixo. Funciona em qualquer app, independente do Google Calendar.'
                      : 'Você não receberá lembretes por email'}
                  </p>
                </div>
                <Switch
                  id="email-reminders-enabled"
                  aria-describedby="email-reminders-description"
                  checked={emailRemindersEnabled}
                  onCheckedChange={setEmailRemindersEnabled}
                />
              </div>

              {emailRemindersEnabled && (
                <div className="border-t border-border pt-4">
                  <Label className="text-sm font-medium mb-3 block">Quando enviar os lembretes por email</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                    {EMAIL_REMINDER_OPTIONS.map(option => (
                      <div key={option.value} className="flex min-h-11 items-center gap-3">
                        <Checkbox
                          id={`email-reminder-${option.value}`}
                          checked={selectedEmailReminders.includes(option.value)}
                          onCheckedChange={() => handleEmailReminderToggle(option.value)}
                        />
                        <Label htmlFor={`email-reminder-${option.value}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm">
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
                <div className="flex-1">
                  <Label htmlFor="optional-communications-paused" className="text-sm font-medium block mb-1">Pausar comunicações opcionais</Label>
                  <p id="optional-communications-description" className="text-xs text-muted-foreground">
                    Vale para todas as igrejas. Convites, recuperação de conta e avisos essenciais de segurança continuam sendo enviados.
                  </p>
                </div>
                  <Switch
                    id="optional-communications-paused"
                    aria-describedby="optional-communications-description"
                    checked={optionalPaused}
                    disabled={!globalPreferencesLoaded || globalPreferencesLoading || saving}
                    onCheckedChange={setOptionalPaused}
                  />
                </div>
                {globalPreferencesLoading && <p role="status">Consultando pausa global…</p>}
                {globalPreferencesError && (
                  <ErrorState title="Pausa global indisponível" message={globalPreferencesError}
                    onRetry={() => void loadGlobalPreferences(minister.church_id)}
                    retrying={globalPreferencesLoading} />
                )}
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="space-y-3 pt-2">
            {saveError && (
              <ErrorState
                title="Não foi possível salvar as preferências"
                message={saveError}
                onRetry={() => void handleSavePreferences()}
                retrying={saving}
              />
            )}
            <Button
              onClick={handleSavePreferences}
              disabled={saving}
              aria-busy={saving}
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
