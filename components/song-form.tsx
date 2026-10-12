'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Song, Minister, YouTubeSearchResult, TONES } from '@/lib/types'
import type { ImportedCifra } from '@/lib/cifralize-scraper'
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
import { isCifralizeUrl } from '@/lib/cifralize-url'
import { isCifraClubUrl } from '@/lib/cifraclub-url'
import { normalizeCifraClubTone, tonesAreEquivalent } from '@/lib/cifraclub-scraper'
import { cn } from '@/lib/utils'

interface SongFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  song?: Song | null
  onSuccess: () => void
  currentMinister: Minister | null
  effectiveChurchId?: string | null
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

function isSupportedCifraUrl(url: string): boolean {
  return isCifraClubUrl(url) || isCifralizeUrl(url)
}

function toneOptionsForMode(tone: string): string[] {
  const normalized = normalizeCifraClubTone(tone) ?? tone.trim()
  if (!normalized) return []

  const isMinor = normalized.endsWith('m') && normalized.length > 1
  const options = TONES.filter((item) => {
    const itemIsMinor = item.endsWith('m') && item.length > 1
    return itemIsMinor === isMinor
  })

  return options.includes(normalized as typeof TONES[number]) ? [...options] : [normalized, ...options]
}

function savedToneOptionsFor(song: Song): string[] {
  if (song.available_tones?.length) return song.available_tones
  return isSupportedCifraUrl(song.cipher_url ?? '') ? toneOptionsForMode(song.tone || '') : []
}

function cifraSourceLabel(url: string): string {
  if (isCifraClubUrl(url)) return 'CifraClub'
  if (isCifralizeUrl(url)) return 'Cifralize'
  return 'link informado'
}

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister, effectiveChurchId }: SongFormProps) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [tone, setTone] = useState('')
  const [cifraTab, setCifraTab] = useState<'link' | 'file'>('link')

  const [cipherUrl, setCipherUrl] = useState('')
  const [cifraContent, setCifraContent] = useState<string[] | null>(null)
  const [availableTones, setAvailableTones] = useState<string[]>([])
  const churchIdForSave = effectiveChurchId ?? currentMinister?.church_id ?? null
  const [cifraContentKey, setCifraContentKey] = useState<string | null>(null)
  const [capoFrets, setCapoFrets] = useState(0)
  const [importingCifra, setImportingCifra] = useState(false)
  /** Tom sendo buscado na fonte da cifra (troca de tom); null = importação inicial pelo link. */
  const [loadingToneForImport, setLoadingToneForImport] = useState<string | null>(null)
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
  const currentCipherUrlRef = useRef('')
  const currentToneRef = useRef('')
  /** Evita reimportar em loop quando a API falha (ex.: bloqueio no servidor da Vercel). */
  const lastAutoImportKeyRef = useRef<string | null>(null)
  const importDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buildImportKey = (url: string, toneValue: string) =>
    `${url}|${normalizeCifraClubTone(toneValue) ?? toneValue}`

  const YOUTUBE_SEARCH_MAX = 8

  useEffect(() => {
    currentCipherUrlRef.current = cipherUrl
  }, [cipherUrl])

  useEffect(() => {
    currentToneRef.current = tone
  }, [tone])

  const applyImportedCifra = useCallback((data: ImportedCifra) => {
    setCifraContent(data.cifra)
    setCipherUrl(data.cipher_url)
    setCifraContentKey(buildImportKey(data.cipher_url, data.tone))
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
      if (!url || !isSupportedCifraUrl(url)) {
        setImportError('Cole um link válido do CifraClub ou Cifralize.')
        return false
      }

      setImportingCifra(true)
      setImportError(null)

      try {
        const params = new URLSearchParams({ url })
        if (toneValue.trim()) params.set('target_tone', toneValue)
        const res = await fetch(`/api/cifra/import?${params.toString()}`)
        const data = (await res.json().catch(() => ({}))) as ImportedCifra & { error?: string }

        if (!res.ok) {
          if (res.status === 429) {
            setImportError(
              data.error ??
                'Muitas importações em pouco tempo. Aguarde alguns minutos ou use a aba PDF.'
            )
          } else {
            setImportError(data.error ?? 'Não foi possível importar. Use a aba PDF.')
          }
          return false
        }

        const currentUrl = ensureHttps(currentCipherUrlRef.current)
        const currentTone = currentToneRef.current.trim()
        const requestedTone = toneValue.trim()

        if (currentUrl !== url || currentTone !== requestedTone) {
          return false
        }

        if (requestedTone && !tonesAreEquivalent(data.tone, requestedTone)) {
          setImportError(`A cifra retornou em ${data.tone}, mas o tom solicitado foi ${requestedTone}. Tente importar novamente.`)
          return false
        }

        applyImportedCifra(data)
        setCipherUrl(data.cipher_url || url)
        lastImportedUrlRef.current = url
        lastImportedToneRef.current = toneValue
        return true
      } catch {
        setImportError('Erro de rede. Tente de novo ou use a aba PDF.')
        return false
      } finally {
        lastAutoImportKeyRef.current = buildImportKey(url, toneValue)
        setImportingCifra(false)
        setLoadingToneForImport(null)
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
    setLoadingToneForImport(null)
    lastYoutubeSearchKeyRef.current = null
    lastImportedUrlRef.current = null
    lastImportedToneRef.current = null
    lastAutoImportKeyRef.current = null

    if (song) {
      setTitle(song.title || '')
      setArtist(song.artist || '')
      setTone(song.tone || '')
      setExistingPdfPath(song.cifra_pdf_path ?? null)
      setCipherUrl(song.cipher_url ?? '')
      setCifraContent(song.cifra_content ?? null)
      setCifraContentKey(
        song.cifra_content?.length && song.cipher_url
          ? buildImportKey(song.cipher_url, song.tone || '')
          : null
      )
      setCapoFrets(song.capo_frets ?? 0)
      setAvailableTones(savedToneOptionsFor(song))
      setCifraTab(defaultCifraTab(song))
      setYoutubeUrl(song.youtube_url || '')
      setYoutubeVideoTitle(song.youtube_video_title || '')
      setYoutubeQuery(`${song.artist} ${song.title}`.trim())
      return
    }

    setTitle('')
    setArtist('')
    setTone('')
    setExistingPdfPath(null)
    setCipherUrl('')
    setCifraContent(null)
    setCifraContentKey(null)
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
    if (!url || !isSupportedCifraUrl(url) || importingCifra) return

    const importKey = buildImportKey(url, tone)
    if (importKey === lastAutoImportKeyRef.current) return

    if (importDebounceRef.current) clearTimeout(importDebounceRef.current)
    importDebounceRef.current = setTimeout(() => {
      if (buildImportKey(url, tone) === lastAutoImportKeyRef.current) return
      if (
        url === lastImportedUrlRef.current &&
        lastImportedToneRef.current &&
        tonesAreEquivalent(tone, lastImportedToneRef.current)
      ) {
        return
      }
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
    if (importingCifra && loadingToneForImport === t) return

    setTone(t)
    const url = ensureHttps(cipherUrl)
    if (cifraTab === 'link' && url && isSupportedCifraUrl(url) && importReady) {
      setCifraContentKey(null)
      lastImportedToneRef.current = null
      lastAutoImportKeyRef.current = null
      setLoadingToneForImport(t)
      void importFromUrl(url, t)
    }
  }

  const handleRetryImport = () => {
    const url = ensureHttps(cipherUrl)
    if (!url || !isSupportedCifraUrl(url)) return
    lastAutoImportKeyRef.current = null
    lastImportedUrlRef.current = null
    lastImportedToneRef.current = null
    void importFromUrl(url, tone)
  }

  const hasYoutube = Boolean(ensureHttps(youtubeUrl))
  const youtubeRequired = cifraTab === 'link'
  const currentCifraContentKey = buildImportKey(ensureHttps(cipherUrl), tone)
  const hasCurrentTextCifra = hasTextCifra && cifraContentKey === currentCifraContentKey

  const canSave =
    cifraTab === 'link'
      ? Boolean(!importingCifra && hasCurrentTextCifra && title.trim() && artist.trim() && tone.trim() && hasYoutube)
      : Boolean(hasPdfSource && title.trim() && artist.trim() && tone.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError(null)

    if (!title.trim() || !artist.trim()) {
      setFormError('Informe título e artista.')
      return
    }

    if (!tone.trim()) {
      setFormError('Selecione o tom da música.')
      return
    }

    if (cifraTab === 'link' && !hasTextCifra) {
      setFormError('Importe a cifra pelo link antes de salvar.')
      return
    }

    if (cifraTab === 'link' && !hasCurrentTextCifra) {
      setFormError('Reimporte a cifra no tom selecionado antes de salvar.')
      return
    }

    if (cifraTab === 'link' && importingCifra) {
      setFormError('Aguarde a importação da cifra terminar antes de salvar.')
      return
    }

    if (cifraTab === 'file' && !hasPdfSource) {
      setFormError('Envie um PDF da cifra.')
      return
    }

    if (youtubeRequired && !hasYoutube) {
      setFormError('Selecione um vídeo de referência no YouTube antes de salvar.')
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
        basePayload.available_tones = availableTones.length ? availableTones : toneOptionsForMode(tone)
      } else if (cifraTab === 'file') {
        basePayload.cifra_content = song?.cifra_content ?? null
        basePayload.cipher_url = song?.cipher_url ?? null
        basePayload.available_tones = []
      } else if (song) {
        basePayload.cifra_content = song.cifra_content
        basePayload.cipher_url = song.cipher_url
        basePayload.available_tones = song.available_tones ?? []
      }

      let songId = song?.id

      const performSave = async (body: Record<string, unknown>) => {
        if (song) {
          return supabase
            .from('songs')
            .update(body)
            .eq('id', song.id)
            .eq('church_id', churchIdForSave)
        }
        return supabase
          .from('songs')
          .insert({ ...body, church_id: churchIdForSave, minister_id: currentMinister?.id })
          .select('id')
          .single()
      }

      let saveResult = await performSave(basePayload)
      if (saveResult.error && /youtube_video_title|cifra_pdf_path|available_tones/i.test(saveResult.error.message ?? '')) {
        const { youtube_video_title, available_tones, ...rest } = basePayload
        saveResult = await performSave(rest)
      }

      if (saveResult.error) throw saveResult.error

      if (!song && saveResult.data && 'id' in saveResult.data) {
        songId = saveResult.data.id as string
      }

      if (!songId) throw new Error('Não foi possível identificar a música.')

      if (cifraTab === 'file' && cifraFile) {
        if (!churchIdForSave) throw new Error('Não foi possível identificar a igreja do ministro.')
        const path = await uploadCifraFile(supabase, churchIdForSave, songId, cifraFile)
        const { error: pathError } = await supabase
          .from('songs')
          .update({ cifra_pdf_path: path })
          .eq('id', songId)
          .eq('church_id', churchIdForSave)
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

  const songDetailsFields = (required?: boolean) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="title" className="text-xs">
          Título{required ? ' *' : ''}
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
          Artista{required ? ' *' : ''}
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

  const toneField = (required?: boolean) =>
    toneChips.length > 0 && cifraTab === 'link' ? (
      <div className="flex flex-wrap gap-1.5">
        <span className="w-full text-xs text-muted-foreground">
          Tom{required ? ' *' : ''} — toque em outro tom para recarregar a cifra
        </span>
        {loadingToneForImport && importingCifra && (
          <div
            className="flex w-full items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-2 text-xs text-primary"
            role="status"
            aria-live="polite"
          >
            <Spinner className="h-3.5 w-3.5 shrink-0" />
            <span>
              Carregando cifra no tom{' '}
              <strong className="font-mono font-semibold">{loadingToneForImport}</strong>…
            </span>
          </div>
        )}
        {toneChips.map((t) => {
          const isActive = tone === t
          const isLoadingThisTone = importingCifra && loadingToneForImport === t
          return (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={isActive ? 'default' : 'outline'}
              className={cn(
                'h-7 font-mono text-xs transition-opacity',
                importingCifra && loadingToneForImport && !isLoadingThisTone && 'opacity-50',
                isLoadingThisTone && 'ring-2 ring-primary ring-offset-1'
              )}
              disabled={importingCifra}
              aria-busy={isLoadingThisTone}
              onClick={() => handleToneChipClick(t)}
            >
              {isLoadingThisTone ? (
                <span className="flex items-center gap-1">
                  <Spinner className="h-3 w-3" />
                  {t}
                </span>
              ) : (
                t
              )}
            </Button>
          )
        })}
        {!tone.trim() && (
          <p className="w-full text-xs text-destructive">Selecione um tom para continuar.</p>
        )}
      </div>
    ) : (
      <div className="space-y-1">
        <Label htmlFor="tone" className="text-xs">
          Tom{required ? ' *' : ''}
        </Label>
        <Select value={tone || undefined} onValueChange={setTone}>
          <SelectTrigger id="tone" className={cn('font-mono', !tone && required && 'border-destructive/60')}>
            <SelectValue placeholder="Selecione o tom" />
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
    <div
      className={cn(
        'space-y-2 rounded-md border bg-muted/20 p-3',
        youtubeRequired && !hasYoutube && 'border-destructive/40'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-sm">
          <Youtube className="h-4 w-4 text-destructive" />
          Vídeo de referência no YouTube
          {youtubeRequired ? (
            <span className="text-destructive">*</span>
          ) : (
            <span className="font-normal text-muted-foreground">(opcional)</span>
          )}
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
            {youtubeRequired
              ? importReady
                ? 'Obrigatório para salvar. Se a importação não trouxe vídeo, busque a versão abaixo.'
                : 'Obrigatório para salvar. Busque a versão que a equipe usa como referência.'
              : 'Opcional — útil para ensaio. Músicas autorais podem ficar sem vídeo.'}
          </p>
          {youtubeRequired && !hasYoutube && (
            <p className="text-xs text-destructive">Selecione um vídeo antes de salvar a música.</p>
          )}
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
            Link do CifraClub/Cifralize ou arquivo PDF — escolha uma das duas formas.
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
                PDF
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="mt-3 space-y-3">
              <Input
                type="url"
                value={cipherUrl}
                onChange={(e) => {
                  setCipherUrl(e.target.value)
                  if (importError) setImportError(null)
                  lastAutoImportKeyRef.current = null
                }}
                placeholder="Cole o link do CifraClub ou Cifralize…"
                className="h-11"
                autoFocus={!song}
                disabled={importingCifra}
              />
              {importingCifra && !loadingToneForImport && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <Spinner className="h-3.5 w-3.5" />
                  Importando cifra do {cifraSourceLabel(ensureHttps(cipherUrl))}…
                </p>
              )}
              {importError && !importingCifra && (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">{importError}</p>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleRetryImport}>
                    Tentar importar de novo
                  </Button>
                </div>
              )}

              {importReady && (
                <div
                  className={cn(
                    'space-y-3 rounded-lg border p-3',
                    hasCurrentTextCifra
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-amber-500/40 bg-amber-500/5'
                  )}
                >
                  <p
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium',
                      hasCurrentTextCifra
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {hasCurrentTextCifra ? <CheckCircle2 className="h-4 w-4" /> : <Spinner className="h-4 w-4" />}
                    {hasCurrentTextCifra ? 'Cifra pronta' : `Atualizando cifra para ${tone || 'o tom selecionado'}...`}
                  </p>
                  {!hasCurrentTextCifra && (
                    <p className="text-xs text-muted-foreground">
                      A cifra anterior continua visível enquanto o novo tom carrega. O salvamento fica bloqueado até terminar.
                    </p>
                  )}
                  {songDetailsFields()}
                  {toneField(true)}
                  {capoFrets > 0 && (
                    <p className="text-xs text-muted-foreground">Capo: {capoFrets}ª casa</p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="file" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Preencha título, artista e tom, depois envie o arquivo da cifra.
              </p>
              {songDetailsFields(true)}
              {toneField(true)}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={handleFileChange}
              />
              <div className="space-y-1">
                <Label className="text-xs">Arquivo da cifra *</Label>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'h-auto min-h-[4.5rem] w-full flex-col gap-1 py-4',
                    !hasPdfSource && 'border-dashed border-destructive/40'
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    {cifraFile
                      ? cifraFile.name
                      : existingPdfPath
                        ? 'Arquivo atual — toque para trocar'
                        : 'Escolher PDF'}
                  </span>
                  <span className="text-xs text-muted-foreground">Máx. 10 MB</span>
                </Button>
                {!hasPdfSource && (
                  <p className="text-xs text-destructive">Envie um PDF da cifra.</p>
                )}
              </div>
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
