'use client'

import { PAGE_WIDTH } from '@/lib/page-layout'
import { useEffect, useState } from 'react'
import type { Church } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type FormState = {
  id?: string
  name: string
  slug: string
  status: Church['status']
  environment: Church['environment']
  email_mode: Church['email_mode']
  plan: string
}

const emptyForm: FormState = {
  name: '',
  slug: '',
  status: 'active',
  environment: 'production',
  email_mode: 'real',
  plan: 'free',
}

export default function PlatformChurchesPage() {
  const [churches, setChurches] = useState<Church[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadChurches = async () => {
    setLoading(true)
    const response = await fetch('/api/platform/churches')
    const result = await response.json()
    if (!response.ok) {
      setError(result.error || 'Erro ao carregar igrejas.')
      setLoading(false)
      return
    }
    setChurches(result.churches ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadChurches()
  }, [])

  const editChurch = (church: Church) => {
    setForm({
      id: church.id,
      name: church.name,
      slug: church.slug,
      status: church.status,
      environment: church.environment,
      email_mode: church.email_mode,
      plan: church.plan,
    })
    setError(null)
  }

  const saveChurch = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const endpoint = form.id ? `/api/platform/churches/${form.id}` : '/api/platform/churches'
    const response = await fetch(endpoint, {
      method: form.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Erro ao salvar igreja.')
      setSaving(false)
      return
    }

    setForm(emptyForm)
    setSaving(false)
    await loadChurches()
  }

  const startImpersonation = async (church: Church) => {
    setError(null)
    const response = await fetch('/api/platform/impersonation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ church_id: church.id }),
    })
    const result = await response.json()
    if (!response.ok) {
      setError(result.error || 'Erro ao iniciar impersonação.')
      return
    }
    window.location.href = '/'
  }

  return (
    <div className="bg-background">

      <main className={`${PAGE_WIDTH} py-6`}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Igrejas</h1>
          <p className="text-sm text-muted-foreground">Administração interna da plataforma.</p>
        </div>

        {error && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        <form onSubmit={saveChurch} className="mb-8 rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-semibold">{form.id ? 'Editar igreja' : 'Nova igreja'}</h2>
            {form.id && <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>Cancelar edição</Button>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))} placeholder="gerado pelo nome se vazio" />
            </div>
            <div className="space-y-2">
              <Label>Plano</Label>
              <Input value={form.plan} onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value: Church['status']) => setForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="inactive">Inativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ambiente</Label>
              <Select value={form.environment} onValueChange={(value: Church['environment']) => setForm((prev) => ({ ...prev, environment: value, email_mode: value === 'production' ? prev.email_mode : prev.email_mode === 'real' ? 'disabled' : prev.email_mode }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="demo">Demo</SelectItem>
                  <SelectItem value="test">Teste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Select value={form.email_mode} onValueChange={(value: Church['email_mode']) => setForm((prev) => ({ ...prev, email_mode: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="real" disabled={form.environment !== 'production'}>Real</SelectItem>
                  <SelectItem value="disabled">Desabilitado</SelectItem>
                  <SelectItem value="test_recipient">Destinatário de teste</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="mt-4" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar igreja'}</Button>
        </form>

        <div className="rounded-xl border border-border bg-card">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
          ) : churches.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Nenhuma igreja cadastrada.</div>
          ) : (
            <div className="divide-y divide-border">
              {churches.map((church) => (
                <div key={church.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold">{church.name}</p>
                    <p className="text-xs text-muted-foreground">{church.slug} · {church.environment} · {church.email_mode} · {church.status} · {church.plan}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => editChurch(church)}>Editar</Button>
                    <Button onClick={() => startImpersonation(church)}>Impersonar</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
