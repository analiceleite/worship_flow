'use client'

import { useEffect, useRef, useState } from 'react'
import { Song, Minister, YouTubeSearchResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { FileUp, Search, X, Youtube } from 'lucide-react'
import { uploadCifraFile, validateCifraFile } from '@/lib/cifra-storage'
import { buildYoutubeSearchCacheKey } from '@/lib/youtube-search-cache'

interface SongFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  song?: Song | null
  onSuccess: () => void
  currentMinister: Minister | null
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function ensureHttps(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister }: SongFormProps) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [cifraFile, setCifraFile] = useState<File | null>(null)
  const [existingPdfPath, setExistingPdfPath] = useState<string | null>(null)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState('')
  const [youtubeManualUrl, setYoutubeManualUrl] = useState('')
  const [youtubeQuery, setYoutubeQuery] = useState('')
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([])
  const [youtubeSearching, setYoutubeSearching] = useState(false)
  const [youtubeSearchError, setYoutubeSearchError] = useState<string | null>(null)
  const [youtubeFromCache, setYoutubeFromCache] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastYoutubeSearchKeyRef = useRef<string | null>(null)

  const YOUTUBE_SEARCH_MAX = 8

  useEffect(() => {
    if (!open) {
      setSaving(false)
      setYoutubeSearching(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    setSaving(false)
    setFormError(null)
    setCifraFile(null)
    setYoutubeResults([])
    setYoutubeSearchError(null)
    setYoutubeFromCache(false)
    setYoutubeManualUrl('')
    lastYoutubeSearchKeyRef.current = null

    if (song) {
      setTitle(song.title || '')
      setArtist(song.artist || '')
      setExistingPdfPath(song.cifra_pdf_path ?? null)
      setYoutubeUrl(song.youtube_url || '')
      setYoutubeVideoTitle(song.youtube_video_title || '')
      setYoutubeQuery(`${song.artist} ${song.title}`.trim())
      return
    }

    setTitle('')
    setArtist('')
    setExistingPdfPath(null)
    setYoutubeUrl('')
    setYoutubeVideoTitle('')
    setYoutubeQuery('')
  }, [open, song])

  useEffect(() => {
    if (!open || song) return
    const q = `${artist} ${title}`.trim()
    if (q.length >= 3) setYoutubeQuery(q)
  }, [open, song, artist, title])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setFormError(null)
    if (!file) {
      setCifraFile(null)
      return
    }
    const validation = validateCifraFile(file)
    if (validation) {
      setFormError(validation)
      setCifraFile(null)
      e.target.value = ''
      return
    }
    setCifraFile(file)
  }

  const handleYoutubeSearch = async (forceRefresh = false) => {
    const q = youtubeQuery.trim()
    if (q.length < 2) {
      setYoutubeSearchError('Digite pelo menos 2 caracteres para buscar.')
      return
    }

    const searchKey = buildYoutubeSearchCacheKey(q, YOUTUBE_SEARCH_MAX)
    if (
      !forceRefresh &&
      lastYoutubeSearchKeyRef.current === searchKey &&
      youtubeResults.length > 0
    ) {
      return
    }

    setYoutubeSearching(true)
    setYoutubeSearchError(null)
    if (forceRefresh) setYoutubeResults([])

    try {
      const params = new URLSearchParams({
        q,
        maxResults: String(YOUTUBE_SEARCH_MAX),
      })
      if (forceRefresh) params.set('refresh', '1')

      const res = await fetch(`/api/youtube/search?${params.toString()}`)
      const data = (await res.json().catch(() => ({}))) as {
        results?: YouTubeSearchResult[]
        cached?: boolean
        error?: string
      }

      if (!res.ok) {
        setYoutubeSearchError(data.error ?? 'Erro ao buscar vídeos.')
        return
      }

      lastYoutubeSearchKeyRef.current = searchKey
      setYoutubeFromCache(Boolean(data.cached))
      setYoutubeResults(data.results ?? [])
      if (!data.results?.length) {
        setYoutubeSearchError('Nenhum vídeo encontrado. Tente outro termo ou cole o link abaixo.')
      }
    } catch {
      setYoutubeSearchError('Não foi possível buscar no YouTube.')
    } finally {
      setYoutubeSearching(false)
    }
  }

  const selectYoutubeVideo = (item: YouTubeSearchResult) => {
    setYoutubeUrl(youtubeWatchUrl(item.videoId))
    setYoutubeVideoTitle(item.title)
    setYoutubeManualUrl(youtubeWatchUrl(item.videoId))
    setYoutubeSearchError(null)
  }

  const clearYoutubeSelection = () => {
    setYoutubeUrl('')
    setYoutubeVideoTitle('')
    setYoutubeManualUrl('')
  }

  const applyManualYoutubeUrl = () => {
    const url = ensureHttps(youtubeManualUrl)
    if (!url) return
    setYoutubeUrl(url)
    setYoutubeVideoTitle('')
    setYoutubeSearchError(null)
  }

  const hasCifraSource = Boolean(cifraFile || existingPdfPath)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError(null)

    if (!title.trim() || !artist.trim()) {
      setFormError('Informe título e artista.')
      return
    }

    if (!song && !cifraFile) {
      setFormError('Envie o PDF ou a foto da cifra.')
      return
    }

    if (song && !cifraFile && !existingPdfPath) {
      setFormError('Envie o PDF ou a foto da cifra.')
      return
    }

    setSaving(true)
    const supabase = createClient()

    try {
      const resolvedYoutube = ensureHttps(youtubeUrl || youtubeManualUrl) || null

      const basePayload = {
        title: toTitleCase(title),
        artist: toTitleCase(artist),
        tone: song?.tone ?? 'C',
        cipher_url: null,
        youtube_url: resolvedYoutube,
        youtube_video_title: youtubeVideoTitle.trim() || null,
        cifra_content: null,
        capo_frets: 0,
      }

      let songId = song?.id

      const performSave = async (body: Record<string, unknown>) => {
        if (song) {
          return supabase.from('songs').update(body).eq('id', song.id)
        }
        return supabase
          .from('songs')
          .insert({ ...body, minister_id: currentMinister?.id })
          .select('id')
          .single()
      }

      let saveResult = await performSave(basePayload)
      if (saveResult.error && /youtube_video_title|cifra_pdf_path/i.test(saveResult.error.message ?? '')) {
        const { youtube_video_title, ...rest } = basePayload
        saveResult = await performSave(rest)
      }

      if (saveResult.error) throw saveResult.error

      if (!song && saveResult.data && 'id' in saveResult.data) {
        songId = saveResult.data.id as string
      }

      if (!songId) throw new Error('Não foi possível identificar a música.')

      if (cifraFile) {
        const path = await uploadCifraFile(supabase, songId, cifraFile)
        let { error: pathError } = await supabase
          .from('songs')
          .update({ cifra_pdf_path: path })
          .eq('id', songId)

        if (pathError && /cifra_pdf_path/i.test(pathError.message ?? '')) {
          throw new Error(
            'Arquivo enviado, mas a coluna cifra_pdf_path não existe. Execute a migration scripts/022_song_cifra_pdf_storage.sql no Supabase.'
          )
        }
        if (pathError) throw pathError
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar a música.'
      setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  const canSave = Boolean(title.trim() && artist.trim() && (song ? hasCifraSource : cifraFile))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{song ? 'Editar música' : 'Nova música'}</DialogTitle>
          <DialogDescription>
            {song
              ? 'Atualize os dados, a cifra (PDF/foto) ou o video de referência.'
              : 'Título, artista e arquivo da cifra. Ideal para cadastro no celular.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="song-form"
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-y-auto pr-1"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome da música"
              required
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="artist">Artista</Label>
            <Input
              id="artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Nome do artista ou banda"
              required
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cifra_file">Cifra (PDF ou foto)</Label>
            <input
              ref={fileInputRef}
              id="cifra_file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Arquivo da cifra em PDF ou imagem"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-[4.5rem] w-full flex-col items-center justify-center gap-2 px-3 py-4 text-center"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-5 w-5 shrink-0" />
              <span className="w-full min-w-0 text-pretty break-words text-sm font-medium leading-snug">
                {cifraFile
                  ? cifraFile.name
                  : existingPdfPath && !cifraFile
                    ? 'Arquivo atual mantido — toque para substituir'
                    : 'Toque para escolher PDF ou foto (galeria ou ficheiros)'}
              </span>
              <span className="w-full min-w-0 text-pretty break-words text-xs leading-snug text-muted-foreground">
                PDF, JPG, PNG ou WebP · máx. 10 MB
              </span>
            </Button>
            {cifraFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setCifraFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                <X className="mr-1 h-3 w-3" />
                Remover arquivo selecionado
              </Button>
            )}
          </div>

          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Youtube className="h-4 w-4 text-destructive" />
              <Label className="text-sm font-medium">Vídeo no YouTube (opcional)</Label>
            </div>

            <div className="flex gap-2">
              <Input
                value={youtubeQuery}
                onChange={(e) => setYoutubeQuery(e.target.value)}
                placeholder="Buscar vídeo..."
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => void handleYoutubeSearch(false)}
                disabled={youtubeSearching || youtubeQuery.trim().length < 2}
                title="Buscar no YouTube"
              >
                {youtubeSearching ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {youtubeResults.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs text-muted-foreground"
                disabled={youtubeSearching}
                onClick={() => void handleYoutubeSearch(true)}
              >
                Buscar novamente (ignorar cache)
              </Button>
            )}

            {youtubeFromCache && youtubeResults.length > 0 && !youtubeSearchError && (
              <p className="text-xs text-muted-foreground">
                Resultados reutilizados do cache — economiza cota da API do YouTube.
              </p>
            )}

            {youtubeSearchError && (
              <p className="text-xs text-muted-foreground">{youtubeSearchError}</p>
            )}

            {youtubeResults.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-background p-1">
                {youtubeResults.map((item) => (
                  <li key={item.videoId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => selectYoutubeVideo(item)}
                    >
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          className="h-10 w-16 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-16 shrink-0 rounded bg-muted" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs font-medium">{item.title}</span>
                        <span className="line-clamp-1 text-[10px] text-muted-foreground">
                          {item.channelTitle}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {youtubeUrl && (
              <div className="flex items-start justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Video selecionado
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {youtubeVideoTitle || youtubeUrl}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={clearYoutubeSelection}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="youtube_manual" className="text-xs text-muted-foreground">
                Ou cole o link do YouTube
              </Label>
              <div className="flex gap-2">
                <Input
                  id="youtube_manual"
                  type="url"
                  value={youtubeManualUrl}
                  onChange={(e) => setYoutubeManualUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={applyManualYoutubeUrl}>
                  Usar
                </Button>
              </div>
            </div>
          </div>

          {formError && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{formError}</AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter className="border-t pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="song-form"
            disabled={saving || !canSave}
            aria-busy={saving}
          >
            {saving ? (
              <>
                <Spinner className="mr-2 h-4 w-4 shrink-0" />
                Salvando…
              </>
            ) : song ? (
              'Salvar'
            ) : (
              'Adicionar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
