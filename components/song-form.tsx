'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Song, Minister, YouTubeSearchResult, TONES } from '@/lib/types'
import type { CifraClubSong } from '@/lib/cifraclub-scraper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/spinner'
import { CheckCircle2, FileUp, Link2, Search, X, Youtube } from 'lucide-react'
import { uploadCifraFile, validateCifraFile } from '@/lib/cifra-storage'
import { buildYoutubeSearchCacheKey } from '@/lib/youtube-search-cache'
import { isCifraClubUrl } from '@/lib/cifraclub-url'

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

function defaultCifraTab(s: Song | null | undefined): 'link' | 'file' {
  if (!s) return 'link'
  if (s.cifra_pdf_path && !(s.cifra_content && s.cifra_content.length > 0)) return 'file'
  return 'link'
}

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister }: SongFormProps) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [tone, setTone] = useState<string>('C')
  const [cifraTab, setCifraTab] = useState<'link' | 'file'>('link')

  const [cipherUrl, setCipherUrl] = useState('')
  const [cifraContent, setCifraContent] = useState<string[] | null>(null)
  const [availableTones, setAvailableTones] = useState<string[]>([])
  const [capoFrets, setCapoFrets] = useState(0)
  const [importingCifra, setImportingCifra] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const [cifraFile, setCifraFile] = useState<File | null>(null)
  const [existingPdfPath, setExistingPdfPath] = useState<string | null>(null)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState('')
  const [youtubeQuery, setYoutubeQuery] = useState('')
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([])
  const [youtubeSearching, setYoutubeSearching] = useState(false)
  const [youtubeSearchError, setYoutubeSearchError] = useState<string | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastYoutubeSearchKeyRef = useRef<string | null>(null)
  const lastImportedUrlRef = useRef<string | null>(null)
  const lastImportedToneRef = useRef<string | null>(null)
  const importDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const YOUTUBE_SEARCH_MAX = 8

  const applyImportedCifra = useCallback((data: CifraClubSong) => {
    setCifraContent(data.cifra)
    setCipherUrl(data.cifraclub_url)
    setTone(data.tone)
    setCapoFrets(data.capo_frets ?? 0)
    setAvailableTones(data.available_tones ?? [])
    if (data.name) setTitle(data.name)
    if (data.artist) setArtist(data.artist)
    if (data.youtube_url) {
      setYoutubeUrl(data.youtube_url)
    }
    setImportError(null)
  }, [])

  const importFromUrl = useCallback(
    async (urlInput: string, toneValue: string) => {
      const url = ensureHttps(urlInput)
      if (!url || !isCifraClubUrl(url)) {
        setImportError('Cole um link válido do Cifra Club.')
        return false
      }

      setImportingCifra(true)
      setImportError(null)

      try {
        const params = new URLSearchParams({ url, target_tone: toneValue })
        const res = await fetch(`/api/cifraclub?${params.toString()}`)
        const data = (await res.json().catch(() => ({}))) as CifraClubSong & { error?: string }

        if (!res.ok) {
          setImportError(data.error ?? 'Não foi possível importar. Use a aba PDF ou foto.')
          return false
        }

        applyImportedCifra(data)
        setCipherUrl(data.cifraclub_url || url)
        lastImportedUrlRef.current = url
        lastImportedToneRef.current = toneValue
        return true
      } catch {
        setImportError('Erro de rede. Tente de novo ou use a aba PDF ou foto.')
        return false
      } finally {
        setImportingCifra(false)
      }
    },
    [applyImportedCifra]
  )

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
    setImportError(null)
    setImportingCifra(false)
    lastYoutubeSearchKeyRef.current = null
    lastImportedUrlRef.current = null
    lastImportedToneRef.current = null

    if (song) {
      setTitle(song.title || '')
      setArtist(song.artist || '')
      setTone(song.tone || 'C')
      setExistingPdfPath(song.cifra_pdf_path ?? null)
      setCipherUrl(song.cipher_url ?? '')
      setCifraContent(song.cifra_content ?? null)
      setCapoFrets(song.capo_frets ?? 0)
      setAvailableTones([])
      setCifraTab(defaultCifraTab(song))
      setYoutubeUrl(song.youtube_url || '')
      setYoutubeVideoTitle(song.youtube_video_title || '')
      setYoutubeQuery(`${song.artist} ${song.title}`.trim())
      return
    }

    setTitle('')
    setArtist('')
    setTone('C')
    setExistingPdfPath(null)
    setCipherUrl('')
    setCifraContent(null)
    setCapoFrets(0)
    setAvailableTones([])
    setCifraTab('link')
    setYoutubeUrl('')
    setYoutubeVideoTitle('')
    setYoutubeQuery('')
  }, [open, song])

  useEffect(() => {
    const q = `${artist} ${title}`.trim()
    if (open && q.length >= 3) setYoutubeQuery(q)
  }, [open, artist, title])

  useEffect(() => {
    if (!open || cifraTab !== 'link') return

    const url = ensureHttps(cipherUrl)
    if (!url || !isCifraClubUrl(url) || importingCifra) return

    if (importDebounceRef.current) clearTimeout(importDebounceRef.current)
    importDebounceRef.current = setTimeout(() => {
      if (url === lastImportedUrlRef.current && lastImportedToneRef.current === tone) return
      void importFromUrl(url, tone)
    }, 650)

    return () => {
      if (importDebounceRef.current) clearTimeout(importDebounceRef.current)
    }
  }, [cipherUrl, tone, open, cifraTab, importingCifra, importFromUrl])

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

  const handleYoutubeSearch = async () => {
    const q = youtubeQuery.trim()
    if (q.length < 2) {
      setYoutubeSearchError('Digite pelo menos 2 caracteres.')
      return
    }

    const searchKey = buildYoutubeSearchCacheKey(q, YOUTUBE_SEARCH_MAX)
    if (lastYoutubeSearchKeyRef.current === searchKey && youtubeResults.length > 0) return

    setYoutubeSearching(true)
    setYoutubeSearchError(null)

    try {
      const res = await fetch(
        `/api/youtube/search?${new URLSearchParams({ q, maxResults: String(YOUTUBE_SEARCH_MAX) })}`
      )
      const data = (await res.json().catch(() => ({}))) as {
        results?: YouTubeSearchResult[]
        error?: string
      }

      if (!res.ok) {
        setYoutubeSearchError(data.error ?? 'Erro ao buscar.')
        return
      }

      lastYoutubeSearchKeyRef.current = searchKey
      setYoutubeResults(data.results ?? [])
      if (!data.results?.length) setYoutubeSearchError('Nenhum vídeo encontrado.')
    } catch {
      setYoutubeSearchError('Não foi possível buscar.')
    } finally {
      setYoutubeSearching(false)
    }
  }

  const selectYoutubeVideo = (item: YouTubeSearchResult) => {
    setYoutubeUrl(youtubeWatchUrl(item.videoId))
    setYoutubeVideoTitle(item.title)
    setYoutubeSearchError(null)
  }

  const clearYoutubeSelection = () => {
    setYoutubeUrl('')
    setYoutubeVideoTitle('')
  }

  const hasTextCifra = Boolean(cifraContent && cifraContent.some((l) => l.trim().length > 0))
  const hasPdfSource = Boolean(cifraFile || existingPdfPath)
  const importReady = hasTextCifra

  const toneChips = availableTones.length > 0 ? availableTones : importReady ? [tone] : []

  const handleToneChipClick = (t: string) => {
    setTone(t)
    const url = ensureHttps(cipherUrl)
    if (cifraTab === 'link' && url && isCifraClubUrl(url) && importReady) {
      lastImportedToneRef.current = null
      void importFromUrl(url, t)
    }
  }

  const canSave =
    cifraTab === 'link'
      ? Boolean(importReady && title.trim() && artist.trim() && tone.trim())
      : Boolean(hasPdfSource && title.trim() && artist.trim() && tone.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError(null)

    if (!title.trim() || !artist.trim() || !tone.trim()) {
      setFormError('Informe título, artista e tom.')
      return
    }

    if (cifraTab === 'link' && !hasTextCifra) {
      setFormError('Importe a cifra pelo link antes de salvar.')
      return
    }

    if (cifraTab === 'file' && !hasPdfSource) {
      setFormError('Envie um PDF ou foto da cifra.')
      return
    }

    setSaving(true)
    const supabase = createClient()

    try {
      const resolvedYoutube = ensureHttps(youtubeUrl) || null
      const resolvedCipherUrl = ensureHttps(cipherUrl) || null

      const basePayload: Record<string, unknown> = {
        title: toTitleCase(title),
        artist: toTitleCase(artist),
        tone: tone.trim(),
        youtube_url: resolvedYoutube,
        youtube_video_title: youtubeVideoTitle.trim() || null,
        capo_frets: capoFrets,
      }

      if (cifraTab === 'link' && hasTextCifra) {
        basePayload.cifra_content = cifraContent
        basePayload.cipher_url = resolvedCipherUrl
      } else if (cifraTab === 'file') {
        basePayload.cifra_content = song?.cifra_content ?? null
        basePayload.cipher_url = song?.cipher_url ?? null
      } else if (song) {
        basePayload.cifra_content = song.cifra_content
        basePayload.cipher_url = song.cipher_url
      }

      let songId = song?.id

      const performSave = async (body: Record<string, unknown>) => {
        if (song) return supabase.from('songs').update(body).eq('id', song.id)
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

      if (cifraTab === 'file' && cifraFile) {
        const path = await uploadCifraFile(supabase, songId, cifraFile)
        const { error: pathError } = await supabase
          .from('songs')
          .update({ cifra_pdf_path: path })
          .eq('id', songId)
        if (pathError) throw pathError
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const previewLines = (cifraContent ?? []).slice(0, 5)

  const songDetailsFields = (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="title" className="text-xs">
          Título
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome da música"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="artist" className="text-xs">
          Artista
        </Label>
        <Input
          id="artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Artista ou banda"
          required
        />
      </div>
    </div>
  )

  const toneField =
    toneChips.length > 0 && cifraTab === 'link' ? (
      <div className="flex flex-wrap gap-1.5">
        <span className="w-full text-xs text-muted-foreground">Tom</span>
        {toneChips.map((t) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={tone === t ? 'default' : 'outline'}
            className="h-7 font-mono text-xs"
            disabled={importingCifra}
            onClick={() => handleToneChipClick(t)}
          >
            {t}
          </Button>
        ))}
      </div>
    ) : (
      <div className="space-y-1">
        <Label htmlFor="tone" className="text-xs">
          Tom
        </Label>
        <Select value={tone} onValueChange={setTone}>
          <SelectTrigger id="tone" className="font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {TONES.map((t) => (
              <SelectItem key={t} value={t} className="font-mono">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )

  const youtubeBlock = (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-sm">
          <Youtube className="h-4 w-4 text-destructive" />
          Vídeo no YouTube
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        {youtubeUrl && (
          <Badge variant="secondary" className="text-[10px]">
            Vinculado
          </Badge>
        )}
      </div>

      {youtubeUrl ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
          <span className="line-clamp-2 text-muted-foreground">
            {youtubeVideoTitle || youtubeUrl}
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={clearYoutubeSelection}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {importReady
              ? 'Nenhum vídeo veio do Cifra Club — busque outra versão abaixo.'
              : 'Busque uma versão de referência no YouTube.'}
          </p>
          <div className="flex gap-2">
            <Input
              value={youtubeQuery}
              onChange={(e) => setYoutubeQuery(e.target.value)}
              placeholder="Nome da música ou artista…"
              className="h-9 flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={youtubeSearching || youtubeQuery.trim().length < 2}
              onClick={() => void handleYoutubeSearch()}
            >
              {youtubeSearching ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {youtubeSearchError && (
            <p className="text-xs text-muted-foreground">{youtubeSearchError}</p>
          )}
          {youtubeResults.length > 0 && (
            <ul className="max-h-28 space-y-1 overflow-y-auto rounded-md border bg-background p-1">
              {youtubeResults.map((item) => (
                <li key={item.videoId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => selectYoutubeVideo(item)}
                  >
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="" className="h-7 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-7 w-10 rounded bg-muted" />
                    )}
                    <span className="line-clamp-2">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{song ? 'Editar música' : 'Nova música'}</DialogTitle>
          <DialogDescription>
            Link do Cifra Club ou arquivo PDF/foto — escolha uma das duas formas.
          </DialogDescription>
        </DialogHeader>

        <form id="song-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto pr-1">
          <Tabs
            value={cifraTab}
            onValueChange={(v) => {
              setCifraTab(v as 'link' | 'file')
              setFormError(null)
              setImportError(null)
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="link" className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Link da cifra
              </TabsTrigger>
              <TabsTrigger value="file" className="gap-1.5">
                <FileUp className="h-3.5 w-3.5" />
                PDF ou foto
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="mt-3 space-y-3">
              <Input
                type="url"
                value={cipherUrl}
                onChange={(e) => {
                  setCipherUrl(e.target.value)
                  if (importError) setImportError(null)
                }}
                placeholder="Cole o link do Cifra Club…"
                className="h-11"
                autoFocus={!song}
                disabled={importingCifra}
              />
              {importingCifra && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" />
                  Importando…
                </p>
              )}
              {importError && !importingCifra && (
                <p className="text-xs text-destructive">{importError}</p>
              )}

              {importReady && (
                <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Cifra pronta
                  </p>
                  {songDetailsFields}
                  {toneField}
                  {capoFrets > 0 && (
                    <p className="text-xs text-muted-foreground">Capo: {capoFrets}ª casa</p>
                  )}
                  {previewLines.length > 0 && (
                    <pre className="max-h-20 overflow-y-auto rounded border bg-background/80 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground">
                      {previewLines.join('\n')}
                      {(cifraContent?.length ?? 0) > 5 ? '\n…' : ''}
                    </pre>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="file" className="mt-3 space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-[4.5rem] w-full flex-col gap-1 py-4"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {cifraFile
                    ? cifraFile.name
                    : existingPdfPath
                      ? 'Arquivo atual — toque para trocar'
                      : 'Escolher PDF ou foto'}
                </span>
                <span className="text-xs text-muted-foreground">Máx. 10 MB</span>
              </Button>
              {songDetailsFields}
              {toneField}
            </TabsContent>
          </Tabs>

          {youtubeBlock}

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
          <Button type="submit" form="song-form" disabled={saving || !canSave} aria-busy={saving}>
            {saving ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Salvando…
              </>
            ) : (
              'Salvar música'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
