'use client'

import { useEffect, useState } from 'react'
import { Song, TONES, Minister } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
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
import { Search } from 'lucide-react'
import type { CifraClubSong } from '@/app/api/cifraclub/route'

interface SongFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  song?: Song | null
  onSuccess: () => void
  currentMinister: Minister | null
}

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister }: SongFormProps) {
  const [loading, setLoading] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupUrl, setLookupUrl] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [sourceTone, setSourceTone] = useState<string | null>(null)
  const [availableTones, setAvailableTones] = useState<string[]>(['C'])
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    tone: 'C',
    cipher_url: '',
    youtube_url: '',
    cifra_content: null as string[] | null,
  })

  useEffect(() => {
    if (!open) return

    setLookupUrl('')
    setLookupError(null)

    if (song) {
      setSourceTone(song.tone || null)
      setAvailableTones(song.tone ? [song.tone] : ['C'])
      setFormData({
        title: song.title || '',
        artist: song.artist || '',
        tone: song.tone || 'C',
        cipher_url: song.cipher_url || '',
        youtube_url: song.youtube_url || '',
        cifra_content: song.cifra_content ?? null,
      })
      return
    }

    setSourceTone(null)
    setAvailableTones(['C'])
    setFormData({
      title: '',
      artist: '',
      tone: 'C',
      cipher_url: '',
      youtube_url: '',
      cifra_content: null,
    })
  }, [open, song])

  useEffect(() => {
    if (!open || !song?.cipher_url) return

    const parsed = parseCifraClubUrl(song.cipher_url)
    if (!parsed) return

    let cancelled = false

    const loadAvailableTones = async () => {
      try {
        const versionParam = parsed.version ? `&version=${encodeURIComponent(parsed.version)}` : ''
        const res = await fetch(`/api/cifraclub?artist=${encodeURIComponent(parsed.artist)}&song=${encodeURIComponent(parsed.song)}${versionParam}`)
        if (!res.ok) return
        const data: CifraClubSong = await res.json()
        if (cancelled) return

        const scraperTones = data.available_tones?.filter((t) => /^[A-G](?:#|b)?m?$/.test(t)) ?? []
        const originalTone = data.tone || song.tone || 'C'
        const base = scraperTones.length > 0 ? scraperTones : [originalTone]
        const merged = song.tone && !base.includes(song.tone) ? [song.tone, ...base] : base
        setAvailableTones(merged)

        // If the song has no saved cifra, populate it now from the scraper
        if (!song.cifra_content && data.cifra && data.cifra.length > 0) {
          setSourceTone(originalTone)
          setFormData(prev => ({
            ...prev,
            tone: prev.tone,           // keep whatever tone the user has selected
            cifra_content: data.cifra,
          }))
        }
      } catch {
        // Keep current state if lookup fails.
      }
    }

    void loadAvailableTones()

    return () => {
      cancelled = true
    }
  }, [open, song])

  // Keep tone select stable: when options are loaded, ensure current value exists.
  useEffect(() => {
    if (!availableTones.length) return

    setFormData(prev => {
      if (availableTones.includes(prev.tone)) return prev

      // Prefer original tone when available, otherwise first valid option.
      const nextTone = sourceTone && availableTones.includes(sourceTone)
        ? sourceTone
        : availableTones[0]

      if (!nextTone || prev.tone === nextTone) return prev
      return { ...prev, tone: nextTone }
    })
  }, [availableTones, sourceTone])

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

  /**
   * Parse a CifraClub URL and return { artist, song, version? }.
   * Accepts:
   * - https://www.cifraclub.com.br/artist-slug/song-slug/
   * - https://www.cifraclub.com.br/artist-slug/song-slug/simplificada.html
   */
  const parseCifraClubUrl = (input: string): { artist: string; song: string; version?: string } | null => {
    try {
      const url = new URL(input.trim())
      const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
      if (parts.length >= 2) {
        const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
        return { artist: parts[0], song: parts[1], version }
      }
    } catch {
      // Input might be "artist/song" shorthand without protocol
      const parts = input.trim().replace(/^\/+|\/+$/g, '').split('/')
      if (parts.length >= 2 && /^[a-z0-9-]+$/.test(parts[0]) && /^[a-z0-9-]+$/.test(parts[1])) {
        const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
        return { artist: parts[0], song: parts[1], version }
      }
    }
    return null
  }

  const handleLookup = async () => {
    setLookupError(null)
    const parsed = parseCifraClubUrl(lookupUrl)
    if (!parsed) {
      setLookupError('Cole uma URL do CifraClub válida, ex.: https://www.cifraclub.com.br/anjo-solto/venha-senhor/')
      return
    }

    setLookupLoading(true)
    try {
      const versionParam = parsed.version ? `&version=${encodeURIComponent(parsed.version)}` : ''
      const res = await fetch(`/api/cifraclub?artist=${encodeURIComponent(parsed.artist)}&song=${encodeURIComponent(parsed.song)}${versionParam}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setLookupError((err as { error?: string }).error ?? `Erro ao buscar (${res.status})`)
        return
      }
      const data: CifraClubSong = await res.json()

      // Strict mode: only accept tones provided by scraper.
      const finalTone = (data.tone ?? '').trim()
      const scraperTones = (data.available_tones ?? []).filter((t) => /^[A-G](?:#|b)?m?$/.test(t))
      if (!finalTone || scraperTones.length === 0 || !scraperTones.includes(finalTone)) {
        setLookupError('Não foi possível validar tom original e tons disponíveis desta música no CifraClub. Tente outra versão da cifra.')
        return
      }

      const tonesForForm = scraperTones
      setAvailableTones(tonesForForm)

      setSourceTone(finalTone)

      setFormData(prev => ({
        ...prev,
        title: toTitleCase(data.name),
        artist: toTitleCase(data.artist),
        cipher_url: data.cifraclub_url ?? '',
        youtube_url: data.youtube_url ?? '',
        cifra_content: data.cifra ?? null,
        tone: finalTone,
      }))
    } catch {
      setLookupError('Não foi possível conectar ao serviço CifraClub. Verifique se ele está rodando.')
    } finally {
      setLookupLoading(false)
    }
  }

  const NOTE_INDEX: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
    F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
    'A#': 10, Bb: 10, B: 11,
  }
  const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

  const parseToneRoot = (tone: string): string | null => {
    const m = tone.trim().match(/^([A-G](?:#|b)?)/)
    return m ? m[1] : null
  }

  const transposeRoot = (root: string, semitones: number) => {
    const idx = NOTE_INDEX[root]
    if (idx == null) return root
    const next = (idx + semitones + 120) % 12
    const prefersFlat = root.includes('b')
    return prefersFlat ? NOTES_FLAT[next] : NOTES_SHARP[next]
  }

  const transposeChordSymbol = (symbol: string, semitones: number) => {
    const [main, bass] = symbol.split('/')

    const transposePart = (part: string) => {
      const m = part.match(/^([A-G](?:#|b)?)(.*)$/)
      if (!m) return part
      return `${transposeRoot(m[1], semitones)}${m[2]}`
    }

    const nextMain = transposePart(main)
    if (!bass) return nextMain
    return `${nextMain}/${transposePart(bass)}`
  }

  const transposeCifra = (lines: string[], fromTone: string, toTone: string): string[] => {
    const fromRoot = parseToneRoot(fromTone)
    const toRoot = parseToneRoot(toTone)
    if (!fromRoot || !toRoot) return lines
    if (fromRoot === toRoot) return lines

    const fromIdx = NOTE_INDEX[fromRoot]
    const toIdx = NOTE_INDEX[toRoot]
    if (fromIdx == null || toIdx == null) return lines

    const semitones = toIdx - fromIdx
    const chordRe = /\b([A-G](?:#|b)?(?:m|maj|min|sus|add|dim|aug)?\d*(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?)\b/g

    return lines.map(line =>
      line.replace(chordRe, (token) => transposeChordSymbol(token, semitones))
    )
  }

  /**
   * Extract unique chord roots from cifra_content and return available tones.
   * Only tones whose root note appears in the chords are available.
   */
  const getAvailableTones = (): string[] => {
    if (availableTones.length > 0) return availableTones
    return formData.tone ? [formData.tone] : ['C']
  }

  // youtube_url is optional — do not block save if scraper couldn't find it
  const isLookupReady = Boolean(
    formData.title.trim() &&
    formData.artist.trim() &&
    formData.cipher_url.trim() &&
    formData.cifra_content &&
    formData.cifra_content.length > 0
  )

  const willTranspose = Boolean(
    sourceTone &&
    formData.cifra_content &&
    sourceTone !== formData.tone
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!song && !isLookupReady) {
      setLookupError('Cole o link da cifra e clique em buscar para preencher os dados automaticamente antes de salvar.')
      return
    }
    setLoading(true)

    const supabase = createClient()
    const normalizedTitle = toTitleCase(formData.title)
    const normalizedArtist = toTitleCase(formData.artist)
    const normalizedCipherUrl = ensureHttps(formData.cipher_url)
    const normalizedYoutubeUrl = ensureHttps(formData.youtube_url)
    const normalizedCifraContent =
      formData.cifra_content && sourceTone && sourceTone !== formData.tone
        ? transposeCifra(formData.cifra_content, sourceTone, formData.tone)
        : formData.cifra_content

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
            cifra_content: normalizedCifraContent ?? null,
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
          cifra_content: normalizedCifraContent ?? null,
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
        cifra_content: null,
      })
    } catch (error) {
      console.error('Erro ao salvar música:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{song ? 'Editar Música' : 'Nova Música'}</DialogTitle>
          <DialogDescription>
            {song
              ? 'Atualize as informações da música.'
              : 'Adicione uma nova música ao repertório.'}
          </DialogDescription>
        </DialogHeader>

        <form id="song-form" onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">

          {/* ── CifraClub lookup (new songs only) ── */}
          {!song && (
            <>
              <div className="space-y-2">
                <Label htmlFor="lookup_url">Buscar no CifraClub</Label>
                <div className="flex gap-2">
                  <Input
                    id="lookup_url"
                    value={lookupUrl}
                    onChange={(e) => { setLookupUrl(e.target.value); setLookupError(null) }}
                    placeholder="https://www.cifraclub.com.br/artista/musica/"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => void handleLookup()}
                    disabled={lookupLoading || !lookupUrl.trim()}
                    title="Buscar cifra"
                  >
                    {lookupLoading ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {lookupError && (
                  <Alert variant="destructive" className="py-2">
                    <AlertDescription className="text-xs">{lookupError}</AlertDescription>
                  </Alert>
                )}
                {formData.cifra_content && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ Cifra carregada ({formData.cifra_content.length} linhas) — campos preenchidos automaticamente.
                  </p>
                )}
              </div>
              <Separator />
            </>
          )}

          {!song ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Dados preenchidos automaticamente</p>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {formData.title || 'Aguardando busca da cifra...'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formData.artist || 'Artista será preenchido automaticamente'}
                </p>
              </div>
              {formData.cipher_url && (
                <p className="truncate text-xs text-muted-foreground">Fonte: {formData.cipher_url}</p>
              )}
              {formData.youtube_url && (
                <p className="truncate text-xs text-muted-foreground">YouTube: {formData.youtube_url}</p>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}

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
                {getAvailableTones().map((tone) => (
                  <SelectItem key={tone} value={tone}>
                    {tone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.cifra_content && getAvailableTones().length < TONES.length && (
              <p className="text-xs text-muted-foreground">
                Apenas tons disponíveis nos acordes da cifra são mostrados
              </p>
            )}
          </div>

          {song && (
            <>
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
            </>
          )}

          {willTranspose && sourceTone && (
            <Alert className="py-2">
              <AlertDescription className="text-xs">
                A cifra será transposta de {sourceTone} para {formData.tone} ao salvar.
              </AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter className="pt-2 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" form="song-form" disabled={loading || (!song && !isLookupReady)}>
            {loading && <Spinner className="mr-2" />}
            {song ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
