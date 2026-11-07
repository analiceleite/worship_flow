'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ProfileName({ name, onSaved }: { name: string; onSaved: (name: string) => void }) {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value.trim() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar seu nome.')
      setValue(result.profile.name)
      onSaved(result.profile.name)
      window.dispatchEvent(new CustomEvent('profile-name-updated', { detail: { name: result.profile.name } }))
      setSaved(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar seu nome.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meu nome</CardTitle>
        <CardDescription>Seu nome e sua foto são os mesmos em todas as igrejas das quais você participa.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit} aria-busy={saving}>
          <div className="space-y-2">
            <Label htmlFor="profile-name">Nome</Label>
            <Input id="profile-name" value={value} required maxLength={200} disabled={saving}
              onChange={event => { setValue(event.target.value); setSaved(false) }} />
          </div>
          {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
          {saved && <p role="status" className="text-sm">Nome atualizado.</p>}
          <Button type="submit" disabled={saving || !value.trim() || value.trim() === name}>
            {saving ? 'Salvando...' : 'Salvar nome'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
