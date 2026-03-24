'use client'

import { useEffect, useRef, useState } from 'react'
import { Song, Minister } from '@/lib/types'
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormData {
  title: string
  artist: string
  tone: string
  cipher_url: string
  youtube_url: string
  cifra_content: string[] | null
}

interface SongFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  song?: Song | null
  onSuccess: () => void
  currentMinister: Minister | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface ParsedCifraUrl {
  artist: string
  song: string
  version?: string
}

/**
 * Parse a CifraClub URL into its slug components.
 * Accepts full URLs or "artist-slug/song-slug" shorthand.
 */
function parseCifraClubUrl(input: string): ParsedCifraUrl | null {
  try {
    const url = new URL(input.trim())
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length >= 2) {
      const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
      return { artist: parts[0], song: parts[1], version }
    }
  } catch {
    // shorthand: artist/song
    const parts = input.trim().replace(/^\/+|\/+$/g, '').split('/')
    if (
      parts.length >= 2 &&
      /^[a-z0-9-]+$/.test(parts[0]) &&
      /^[a-z0-9-]+$/.test(parts[1])
    ) {
      const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
      return { artist: parts[0], song: parts[1], version }
    }
  }
  return null
}

function buildApiUrl(parsed: ParsedCifraUrl, targetTone?: string): string {
  const params = new URLSearchParams({
    artist: parsed.artist,
    song: parsed.song,
  })
  if (parsed.version) params.set('version', parsed.version)
  if (targetTone) params.set('target_tone', targetTone)
  return `/api/cifraclub?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SongForm({ open, onOpenChange, song, onSuccess, currentMinister }: SongFormProps) {
  // ── State ──────────────────────────────────────────────────────────────────

  const [lookupUrl, setLookupUrl] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Tones that are confirmed available for this song by the CifraClub API.
  // This is the SINGLE source of truth — never derived from the cifra content.
  const [availableTones, setAvailableTones] = useState<string[]>([])

  // Whether the cifra shown in formData is in sync with the selected tone.
  const [cifraLoading, setCifraLoading] = useState(false)
  const [cifraError, setCifraError] = useState<string | null>(null)
  const [capoFrets, setCapoFrets] = useState<number | null>(null)

  const [formData, setFormData] = useState<FormData>({
    title: '',
    artist: '',
    tone: '',
    cipher_url: '',
    youtube_url: '',
    cifra_content: null,
  })

  const [saving, setSaving] = useState(false)

  // Ref to track the in-flight tone fetch so we can cancel stale requests.
  const cifraAbortRef = useRef<AbortController | null>(null)
  // Ref to track which (url, tone) pair the current cifra_content belongs to.
  const cifraKeyRef = useRef('')

  // ── Reset on open/close ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return

    setLookupUrl('')
    setLookupError(null)
    setCifraError(null)
    cifraKeyRef.current = ''
    setCapoFrets(null)

    if (song) {
      const tone = song.tone || ''
      setFormData({
        title: song.title || '',
        artist: song.artist || '',
        tone,
        cipher_url: song.cipher_url || '',
        youtube_url: song.youtube_url || '',
        // When editing, always re-fetch from API to get a fresh cifra.
        cifra_content: null,
      })
      // Start with empty available tones — the sync effect will populate them
      // from the API. The select stays disabled until the API responds.
      setAvailableTones([])
      setCapoFrets(null)
      return
    }

    // New song
    setAvailableTones([])
    setFormData({
      title: '',
      artist: '',
      tone: '',
      cipher_url: '',
      youtube_url: '',
      cifra_content: null,
    })
    setCapoFrets(null)
  }, [open, song])

  // ── Tone-sync effect ───────────────────────────────────────────────────────
  // Runs whenever cipher_url or tone changes. Fetches the cifra for the current
  // (cipher_url, tone) pair from the API. The API is the single source of truth:
  // it fetches the CifraClub page with the correct ?key= param for that tone.

  useEffect(() => {
    if (!open) return

    const cipherUrl = ensureHttps(formData.cipher_url)
    const selectedTone = formData.tone

    if (!cipherUrl || !selectedTone) return

    const parsed = parseCifraClubUrl(cipherUrl)
    if (!parsed) return

    const syncKey = `${parsed.artist}|${parsed.song}|${parsed.version ?? ''}|${selectedTone}`
    if (syncKey === cifraKeyRef.current) return

    // Cancel any previous in-flight request
    cifraAbortRef.current?.abort()
    const controller = new AbortController()
    cifraAbortRef.current = controller

    const fetchCifra = async () => {
      setCifraLoading(true)
      setCifraError(null)

      try {
        const url = buildApiUrl(parsed, selectedTone)
        const res = await fetch(url, { signal: controller.signal })

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string; available_tones?: string[] }
          // If the API returned updated available_tones (e.g. tone not found), update them.
          if (err.available_tones && err.available_tones.length > 0) {
            setAvailableTones(err.available_tones)
          }
          setCifraError(err.error ?? `Erro ao buscar cifra (${res.status}).`)
          return
        }

        const data: CifraClubSong = await res.json()

        // Update available tones from this response (freshest data)
        if (data.available_tones && data.available_tones.length > 0) {
          setAvailableTones(data.available_tones)
        }
        setCapoFrets(typeof data.capo_frets === 'number' ? data.capo_frets : null)

        // Update formData with the cifra and metadata.
        // IMPORTANT: never overwrite `tone` here — the user may have already
        // changed it while this fetch was in flight. The tone the user selected
        // is the source of truth; the API just fetches the cifra for that tone.
        setFormData(prev => ({
          ...prev,
          title: prev.title || toTitleCase(data.name),
          artist: prev.artist || toTitleCase(data.artist),
          youtube_url: prev.youtube_url || data.youtube_url || '',
          cifra_content: data.cifra && data.cifra.length > 0 ? data.cifra : prev.cifra_content,
        }))

        cifraKeyRef.current = syncKey
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setCifraError('Não foi possível buscar a cifra no CifraClub.')
      } finally {
        setCifraLoading(false)
      }
    }

    void fetchCifra()

    return () => {
      controller.abort()
    }
    // Only re-run when the URL or tone changes (not every formData change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formData.cipher_url, formData.tone])

  // ── Lookup handler (new songs) ─────────────────────────────────────────────

  const handleLookup = async () => {
    setLookupError(null)

    const parsed = parseCifraClubUrl(lookupUrl)
    if (!parsed) {
      setLookupError(
        'Cole uma URL do CifraClub válida, ex.: https://www.cifraclub.com.br/anjo-solto/venha-senhor/'
      )
      return
    }

    setLookupLoading(true)
    try {
      // First fetch: no target tone — just get metadata + default tone + available tones
      const res = await fetch(buildApiUrl(parsed))
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setLookupError(err.error ?? `Erro ao buscar (${res.status})`)
        return
      }

      const data: CifraClubSong = await res.json()

      const tones = data.available_tones?.filter(t => /^[A-G](?:#|b)?m?$/.test(t)) ?? []
      if (!data.tone || tones.length === 0) {
        setLookupError(
          'Não foi possível obter os tons disponíveis desta música no CifraClub. Tente outra versão da cifra.'
        )
        return
      }

      // Validate that the returned tone is actually in the available list
      if (!tones.includes(data.tone)) {
        setLookupError(
          'Tom padrão retornado pelo CifraClub não está na lista de tons disponíveis. Tente outra versão da cifra.'
        )
        return
      }

      setAvailableTones(tones)
      setCapoFrets(typeof data.capo_frets === 'number' ? data.capo_frets : null)
      cifraKeyRef.current = '' // force the sync effect to re-run

      setFormData({
        title: toTitleCase(data.name),
        artist: toTitleCase(data.artist),
        tone: data.tone,
        cipher_url: data.cifraclub_url || `https://www.cifraclub.com.br/${parsed.artist}/${parsed.song}/`,
        youtube_url: data.youtube_url || '',
        cifra_content: data.cifra && data.cifra.length > 0 ? data.cifra : null,
      })
    } catch {
      setLookupError('Não foi possível conectar ao CifraClub. Tente novamente.')
    } finally {
      setLookupLoading(false)
    }
  }

  // ── Tone change handler ────────────────────────────────────────────────────

  const handleToneChange = (newTone: string) => {
    // Only allow tones confirmed by the API
    if (!availableTones.includes(newTone)) return

    setLookupError(null)
    setCifraError(null)
    // Clear the sync key BEFORE updating formData so the effect
    // always sees a new (url, tone) pair and re-fetches immediately.
    cifraKeyRef.current = ''
    // Changing tone will trigger the sync effect to fetch the new cifra.
    // Reset cifra_content so the UI shows loading state while fetching.
    setFormData(prev => ({ ...prev, tone: newTone, cifra_content: null }))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (cifraLoading) {
      setLookupError('Aguarde a cifra terminar de carregar antes de salvar.')
      return
    }

    const selectedTone = formData.tone
    const cipherUrl = ensureHttps(formData.cipher_url)

    // For new songs: require lookup to have been done
    if (!song && (!formData.title.trim() || !selectedTone || !formData.cifra_content)) {
      setLookupError('Cole o link da cifra e clique em buscar para preencher os dados antes de salvar.')
      return
    }

    setSaving(true)
    setLookupError(null)

    const supabase = createClient()

    try {
      // ── Always re-fetch the cifra from the API right before saving ───────
      // This guarantees we persist exactly what the CifraClub serves for this
      // (song, tone) pair — never a locally transposed version.
      let cifraToSave: string[] | null = formData.cifra_content

      const parsed = parseCifraClubUrl(cipherUrl)
      if (parsed && selectedTone) {
        const res = await fetch(buildApiUrl(parsed, selectedTone))
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(err.error ?? `Erro ${res.status} ao buscar cifra para salvar.`)
        }
        const data: CifraClubSong = await res.json()

        if (!data.cifra || data.cifra.length === 0) {
          throw new Error('A cifra retornada pelo CifraClub está vazia.')
        }

        cifraToSave = data.cifra
      }

      if (!cifraToSave || cifraToSave.length === 0) {
        throw new Error('Nenhuma cifra disponível para salvar.')
      }

      const payload = {
        title: toTitleCase(formData.title),
        artist: toTitleCase(formData.artist),
        tone: selectedTone,
        cipher_url: cipherUrl || null,
        youtube_url: ensureHttps(formData.youtube_url) || null,
        cifra_content: cifraToSave,
      }

      if (song) {
        const { error } = await supabase.from('songs').update(payload).eq('id', song.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('songs').insert({
          ...payload,
          minister_id: currentMinister?.id,
        })
        if (error) throw error
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido ao salvar.'
      setLookupError(msg)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedTone = formData.tone
  const isLookupDone = Boolean(
    formData.title.trim() &&
    formData.artist.trim() &&
    selectedTone &&
    formData.cifra_content &&
    formData.cifra_content.length > 0
  )
  const canSave = song ? Boolean(selectedTone) : isLookupDone

  // ── Render ─────────────────────────────────────────────────────────────────

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

        <form
          id="song-form"
          onSubmit={handleSubmit}
          className="space-y-4 overflow-y-auto flex-1 pr-1"
        >
          {/* ── CifraClub lookup (new songs only) ── */}
          {!song && (
            <>
              <div className="space-y-2">
                <Label htmlFor="lookup_url">Buscar no CifraClub</Label>
                <div className="flex gap-2">
                  <Input
                    id="lookup_url"
                    value={lookupUrl}
                    onChange={(e) => {
                      setLookupUrl(e.target.value)
                      setLookupError(null)
                    }}
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
                    {lookupLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {lookupError && (
                  <Alert variant="destructive" className="py-2">
                    <AlertDescription className="text-xs">{lookupError}</AlertDescription>
                  </Alert>
                )}

                {isLookupDone && !cifraLoading && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ Cifra carregada ({formData.cifra_content!.length} linhas) — campos preenchidos automaticamente.
                  </p>
                )}
              </div>
              <Separator />
            </>
          )}

          {/* ── Song metadata ── */}
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
                <p className="truncate text-xs text-muted-foreground">
                  Fonte: {formData.cipher_url}
                </p>
              )}
              {formData.youtube_url && (
                <p className="truncate text-xs text-muted-foreground">
                  YouTube: {formData.youtube_url}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Nome da música"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="artist">Artista</Label>
                <Input
                  id="artist"
                  value={formData.artist}
                  onChange={(e) => setFormData({ ...formData, artist: e.target.value })}
                  placeholder="Nome do artista ou banda"
                  required
                />
              </div>
            </>
          )}

          {/* ── Tone selector ── */}
          <div className="space-y-2">
            <Label htmlFor="tone">Tom</Label>
            <Select
              value={selectedTone}
              onValueChange={handleToneChange}
              disabled={availableTones.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    availableTones.length === 0
                      ? song
                        ? 'Carregando tons...'
                        : 'Busque a cifra primeiro'
                      : 'Selecione o tom'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableTones.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {cifraLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" />
                Buscando cifra no CifraClub para o tom {selectedTone}...
              </p>
            )}
            {cifraError && !cifraLoading && (
              <p className="text-xs text-destructive">{cifraError}</p>
            )}
            {!cifraLoading && !cifraError && formData.cifra_content && selectedTone && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                ✓ Cifra em tom {selectedTone} pronta para salvar.
              </p>
            )}
            {capoFrets !== null && capoFrets > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 rounded-md bg-amber-50 dark:bg-amber-900/20 px-2 py-1">
                <span className="font-semibold">Capotraste:</span>
                <span>{capoFrets}ª casa</span>
                <span className="text-[11px] text-muted-foreground">
                  (cifra já transposta para soar no tom escolhido)
                </span>
              </div>
            )}
          </div>

          {/* ── Edit-only fields ── */}
          {song && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cipher_url">Link da Cifra (opcional)</Label>
                <Input
                  id="cipher_url"
                  type="url"
                  value={formData.cipher_url}
                  onChange={(e) => setFormData({ ...formData, cipher_url: e.target.value })}
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
                  onChange={(e) => setFormData({ ...formData, youtube_url: e.target.value })}
                  onBlur={(e) =>
                    setFormData({ ...formData, youtube_url: ensureHttps(e.target.value) })
                  }
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
            </>
          )}

          {/* ── Global error (save step) ── */}
          {lookupError && song && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{lookupError}</AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter className="pt-2 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="song-form"
            disabled={saving || cifraLoading || !canSave}
          >
            {saving && <Spinner className="mr-2" />}
            {song ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
