'use client'

import { useEffect, useState } from 'react'
import { Minister, INSTRUMENTS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/spinner'
import { MailCheck } from 'lucide-react'
import { churchFetch } from '@/lib/auth/client-context'

interface MinisterFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  minister?: Minister | null
  currentMinister?: Minister | null
  effectiveChurchId?: string | null
  onSuccess: () => void
}

export function MinisterForm({
  open,
  onOpenChange,
  minister,
  currentMinister,
  effectiveChurchId,
  onSuccess,
}: MinisterFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invited, setInvited] = useState<{ email: string; sent: boolean } | null>(null)
  const parseInstruments = (value: string | null | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const [formData, setFormData] = useState({
    name: minister?.name || '',
    email: minister?.email || '',
    instruments: minister?.role === 'midia'
      ? ['Midia']
      : parseInstruments(minister?.instrument).length > 0 ? parseInstruments(minister?.instrument) : ['Voz'],
    role: minister?.role || 'minister',
  })

  const roles: Array<{ id: Minister['role']; label: string }> = [
    { id: 'minister', label: 'Ministro' },
    { id: 'midia', label: 'Mídia' },
    { id: 'admin', label: 'Administrador' },
  ]

  useEffect(() => {
    if (!open) return

    setError(null)
    setInvited(null)

    if (minister) {
      const parsedInstruments = parseInstruments(minister.instrument)
      setFormData({
        name: minister.name || '',
        email: minister.email || '',
        instruments: minister.role === 'midia' ? ['Midia'] : parsedInstruments.length > 0 ? parsedInstruments : ['Voz'],
        role: minister.role || 'minister',
      })
      return
    }

    setFormData({ name: '', email: '', instruments: ['Voz'], role: 'minister' })
  }, [open, minister])

  const toggleInstrument = (instrument: string) => {
    if (formData.role === 'midia') return
    setFormData((prev) => {
      const exists = prev.instruments.includes(instrument)
      const next = exists
        ? prev.instruments.filter((item) => item !== instrument)
        : [...prev.instruments, instrument]
      return { ...prev, instruments: next }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (formData.role !== 'midia' && formData.instruments.length === 0) {
      setError('Selecione ao menos uma função para o ministro.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const instrumentValue = formData.instruments.join(', ')

    try {
      if (minister) {
        // Update existing minister
        const { error } = await supabase
          .from('ministers')
          .update({
            role: formData.role,
            instrument: instrumentValue,
          })
          .eq('id', minister.id)
          .eq('church_id', effectiveChurchId ?? currentMinister?.church_id ?? minister.church_id)

        if (error) throw error
      } else {
        // Administrative onboarding creates an invitation, never an account or a
        // temporary password. The person sets their own credential on accept.
        const churchId = effectiveChurchId ?? currentMinister?.church_id
        if (!churchId) throw new Error('Não foi possível identificar a igreja atual.')
        const response = await churchFetch(churchId, '/api/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            name: formData.name,
            instrument: instrumentValue,
            role: formData.role,
          }),
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Erro ao enviar o convite')
        }

        setInvited({ email: formData.email, sent: result.delivery?.status === 'sent' })
        onSuccess()
        return
      }

      onSuccess()
      onOpenChange(false)
      setFormData({ name: '', email: '', instruments: ['Voz'], role: 'minister' })
      setInvited(null)
    } catch (error: any) {
      console.error('Erro ao salvar ministro:', error)
      setError(error.message || 'Erro ao salvar ministro')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setFormData({ name: '', email: '', instruments: ['Voz'], role: 'minister' })
    setInvited(null)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {invited ? 'Convite enviado' : minister ? 'Editar Ministro' : 'Convidar Ministro'}
          </DialogTitle>
          <DialogDescription>
            {invited
              ? 'A pessoa receberá um link para criar a própria conta e entrar nesta igreja.'
              : minister
              ? 'Atualize as informações do ministro.'
              : 'Envie um convite para a pessoa entrar no time.'}
          </DialogDescription>
        </DialogHeader>

        {invited ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="flex items-center gap-2">
                <MailCheck className="h-4 w-4" />
                {invited.sent
                  ? `Convite enviado para ${invited.email}.`
                  : `Convite registrado para ${invited.email}.`}
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              {invited.sent
                ? 'A pessoa deve abrir o link recebido e criar a senha. O convite expira em alguns dias.'
                : 'O envio do e-mail não foi confirmado. Use "Reenviar" na lista de convites para tentar novamente.'}
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="Nome do ministro"
              required
              disabled={!!minister}
            />
            {minister && <p className="text-xs text-muted-foreground">O nome e a foto são globais e editados pela própria pessoa no perfil.</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              placeholder="email@exemplo.com"
              required={!minister}
              disabled={!!minister}
            />
          </div>

          <div className="space-y-2">
            <Label>Papel</Label>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <Button
                  key={r.id}
                  type="button"
                  variant={formData.role === r.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormData(prev => ({ ...prev, role: r.id, instruments: r.id === 'midia' ? ['Midia'] : prev.instruments.length && prev.instruments[0] !== 'Midia' ? prev.instruments : ['Voz'] }))}
                >
                  {r.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Escolha o papel do usuário.</p>
          </div>

          <div className="space-y-2">
            <Label>Funções</Label>
            <div className="flex flex-wrap gap-2">
              {INSTRUMENTS.map((instrument) => {
                const selected = formData.instruments.includes(instrument)
                return (
                  <Button
                    key={instrument}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleInstrument(instrument)}
                    disabled={formData.role === 'midia'}
                    title={formData.role === 'midia' ? 'Usuário de mídia não pode ter funções musicais.' : undefined}
                  >
                    {instrument}
                  </Button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {formData.role === 'midia'
                ? 'Usuários de mídia recebem automaticamente a função Midia.'
                : 'Selecione uma ou mais funções. Exemplo: Voz, Violão, Teclado.'}
            </p>
          </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Spinner className="mr-2" />}
                {minister ? 'Salvar' : 'Enviar convite'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
