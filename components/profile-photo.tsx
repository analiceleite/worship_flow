'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@/lib/profile-avatar'

export function ProfilePhoto({ name, avatarUrl, onSaved }: {
  name: string
  avatarUrl: string | null
  onSaved: (url: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const save = async (remove: boolean) => {
    if (!remove && !file) return
    setBusy(true)
    try {
      const form = new FormData()
      if (file) form.set('photo', file)
      const response = await fetch('/api/profile/avatar', {
        method: remove ? 'DELETE' : 'POST',
        body: remove ? undefined : form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar sua foto.')
      onSaved(result.avatar_url)
      window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { avatarUrl: result.avatar_url } }))
      setFile(null)
      toast.success(remove ? 'Foto removida.' : 'Foto de perfil atualizada!')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar sua foto.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Foto de perfil</CardTitle>
        <CardDescription>Sua foto aparece no menu da conta. Use JPG, PNG ou WebP de até 2 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <Avatar className="h-24 w-24 shrink-0">
          <AvatarImage src={preview || avatarUrl || undefined} alt={`Foto de ${name}`} className="object-cover" />
          <AvatarFallback className="text-2xl">{name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="space-y-3">
          <input ref={input} type="file" accept={AVATAR_MIME_TYPES.join(',')} className="sr-only" aria-label="Selecionar foto de perfil" disabled={busy} onChange={event => {
            const selected = event.target.files?.[0]
            event.target.value = ''
            if (!selected) return
            if (!(AVATAR_MIME_TYPES as readonly string[]).includes(selected.type)) {
              toast.error('Use uma foto JPG, PNG ou WebP.')
              return
            }
            if (!selected.size || selected.size > AVATAR_MAX_BYTES) {
              toast.error('Selecione uma foto de até 2 MB.')
              return
            }
            setFile(selected)
          }} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Camera className="mr-2 h-4 w-4" />{avatarUrl ? 'Trocar foto' : 'Adicionar foto'}</Button>
            {file && <>
              <Button disabled={busy} onClick={() => save(false)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar foto</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setFile(null)}>Cancelar</Button>
            </>}
            {avatarUrl && !file && <Button variant="ghost" disabled={busy} onClick={() => save(true)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Remover foto</Button>}
          </div>
          <p className="text-xs text-muted-foreground">{file ? 'Confira a pré-visualização e clique em Salvar foto.' : 'Escolha uma foto em que seu rosto esteja centralizado.'}</p>
        </div>
      </CardContent>
    </Card>
  )
}
