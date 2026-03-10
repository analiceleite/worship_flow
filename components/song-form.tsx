'use client'

import { useEffect, useState } from 'react'
import { Song, TONES, Minister } from '@/lib/types'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/spinner'

interface SongFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  song?: Song | null
  onSuccess: () => void
  currentMinister: Minister | null
}

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister }: SongFormProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    tone: 'C',
    cipher_url: '',
    youtube_url: '',
  })

  useEffect(() => {
    if (!open) return

    if (song) {
      setFormData({
        title: song.title || '',
        artist: song.artist || '',
        tone: song.tone || 'C',
        cipher_url: song.cipher_url || '',
        youtube_url: song.youtube_url || '',
      })
      return
    }

    setFormData({
      title: '',
      artist: '',
      tone: 'C',
      cipher_url: '',
      youtube_url: '',
    })
  }, [open, song])

  const toTitleCase = (value: string) =>
    value
      .trim()
      .replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())

  const ensureHttps = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const normalizedTitle = toTitleCase(formData.title)
    const normalizedArtist = toTitleCase(formData.artist)
    const normalizedCipherUrl = ensureHttps(formData.cipher_url)
    const normalizedYoutubeUrl = ensureHttps(formData.youtube_url)

    try {
      if (song) {
        const { error } = await supabase
          .from('songs')
          .update({
            title: normalizedTitle,
            artist: normalizedArtist,
            tone: formData.tone,
            cipher_url: normalizedCipherUrl || null,
            youtube_url: normalizedYoutubeUrl || null,
          })
          .eq('id', song.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('songs').insert({
          title: normalizedTitle,
          artist: normalizedArtist,
          tone: formData.tone,
          cipher_url: normalizedCipherUrl || null,
          youtube_url: normalizedYoutubeUrl || null,
          minister_id: currentMinister?.id,
        })

        if (error) throw error
      }

      onSuccess()
      onOpenChange(false)
      setFormData({
        title: '',
        artist: '',
        tone: 'C',
        cipher_url: '',
        youtube_url: '',
      })
    } catch (error) {
      console.error('Erro ao salvar música:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{song ? 'Editar Música' : 'Nova Música'}</DialogTitle>
          <DialogDescription>
            {song
              ? 'Atualize as informações da música.'
              : 'Adicione uma nova música ao repertório.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="Nome da música"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="artist">Artista</Label>
            <Input
              id="artist"
              value={formData.artist}
              onChange={(e) =>
                setFormData({ ...formData, artist: e.target.value })
              }
              placeholder="Nome do artista ou banda"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tone">Tom</Label>
            <Select
              value={formData.tone}
              onValueChange={(value) =>
                setFormData({ ...formData, tone: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tom" />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((tone) => (
                  <SelectItem key={tone} value={tone}>
                    {tone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cipher_url">Link da Cifra (opcional)</Label>
            <Input
              id="cipher_url"
              type="url"
              value={formData.cipher_url}
              onChange={(e) =>
                setFormData({ ...formData, cipher_url: e.target.value })
              }
              onBlur={(e) =>
                setFormData({ ...formData, cipher_url: ensureHttps(e.target.value) })
              }
              placeholder="https://cifraclub.com.br/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="youtube_url">Link do YouTube (opcional)</Label>
            <Input
              id="youtube_url"
              type="url"
              value={formData.youtube_url}
              onChange={(e) =>
                setFormData({ ...formData, youtube_url: e.target.value })
              }
              onBlur={(e) =>
                setFormData({ ...formData, youtube_url: ensureHttps(e.target.value) })
              }
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="mr-2" />}
              {song ? 'Salvar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
