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
import { Copy } from 'lucide-react'

interface MinisterFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  minister?: Minister | null
  onSuccess: () => void
}

export function MinisterForm({
  open,
  onOpenChange,
  minister,
  onSuccess,
}: MinisterFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)
  const parseInstruments = (value: string | null | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const [formData, setFormData] = useState({
    name: minister?.name || '',
    email: minister?.email || '',
    instruments: parseInstruments(minister?.instrument).length > 0 ? parseInstruments(minister?.instrument) : ['Voz'],
  })

  useEffect(() => {
    if (!open) return

    setError(null)
    setTemporaryPassword(null)

    if (minister) {
      const parsedInstruments = parseInstruments(minister.instrument)
      setFormData({
        name: minister.name || '',
        email: minister.email || '',
        instruments: parsedInstruments.length > 0 ? parsedInstruments : ['Voz'],
      })
      return
    }

    setFormData({ name: '', email: '', instruments: ['Voz'] })
  }, [open, minister])

  const toggleInstrument = (instrument: string) => {
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

    if (formData.instruments.length === 0) {
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
            name: formData.name,
            email: formData.email || null,
            instrument: instrumentValue,
          })
          .eq('id', minister.id)

        if (error) throw error
      } else {
        // Create new minister via API route
        const response = await fetch('/api/ministers/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            name: formData.name,
            instrument: instrumentValue,
          }),
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Erro ao criar ministro')
        }

        // Show temporary password to admin
        setTemporaryPassword(result.temporaryPassword)
        
        // Don't close dialog yet - show password first
        onSuccess()
        return
      }

      onSuccess()
      onOpenChange(false)
      setFormData({ name: '', email: '', instruments: ['Voz'] })
      setTemporaryPassword(null)
    } catch (error: any) {
      console.error('Erro ao salvar ministro:', error)
      setError(error.message || 'Erro ao salvar ministro')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setFormData({ name: '', email: '', instruments: ['Voz'] })
    setTemporaryPassword(null)
    setError(null)
  }

  const copyPassword = () => {
    if (temporaryPassword) {
      navigator.clipboard.writeText(temporaryPassword)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {temporaryPassword ? 'Ministro Criado!' : minister ? 'Editar Ministro' : 'Novo Ministro'}
          </DialogTitle>
          <DialogDescription>
            {temporaryPassword
              ? 'Copie a senha temporária e envie ao ministro.'
              : minister
              ? 'Atualize as informações do ministro.'
              : 'Adicione um novo ministro ao time.'}
          </DialogDescription>
        </DialogHeader>

        {temporaryPassword ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                <strong>Email:</strong> {formData.email}
              </AlertDescription>
            </Alert>
            <Alert>
              <AlertDescription className="flex items-center justify-between">
                <div>
                  <strong>Senha temporária:</strong> {temporaryPassword}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={copyPassword}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              Envie essas credenciais ao ministro. No primeiro acesso, ele deverá definir uma nova senha.
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
            />
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
            {/* {!minister && (
              <p className="text-xs text-muted-foreground">
                Um convite será enviado para este email
              </p>
            )} */}
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
                  >
                    {instrument}
                  </Button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione uma ou mais funções. Exemplo: Voz, Violão, Teclado.
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
                {minister ? 'Salvar' : 'Adicionar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
