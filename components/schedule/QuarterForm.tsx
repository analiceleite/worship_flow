'use client'

import { useState } from 'react'
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

export interface QuarterSummary {
  id: string
  name: string
  start_date: string
  end_date: string
  is_published: boolean
  created_at: string
}

interface QuarterFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (quarter: QuarterSummary) => void
}

export function QuarterForm({ open, onOpenChange, onCreated }: QuarterFormProps) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClose = (nextOpen: boolean) => {
    if (!saving) {
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setError(null)
      }
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/schedule/quarters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
        }),
      })

      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Não foi possível criar o trimestre')
      }

      onCreated(body.quarter)
      setName('')
      setStartDate('')
      setEndDate('')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar trimestre')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Trimestre</DialogTitle>
          <DialogDescription>
            Defina o período para gerar automaticamente todas as quintas e domingos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quarter-name">Nome</Label>
            <Input
              id="quarter-name"
              placeholder="Ex.: Março a Maio 2026"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quarter-start">Data inicial</Label>
              <Input
                id="quarter-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quarter-end">Data final</Label>
              <Input
                id="quarter-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Criando...' : 'Criar trimestre'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
