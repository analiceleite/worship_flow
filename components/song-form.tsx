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
  const [lookupSourceTone, setLookupSourceTone] = useState<string | null>(null)
  const hasExplicitKeyInCipherUrl = /#.*(?:^|&)key=\d+/i.test(song?.cipher_url || '')
  // Se a URL tem #key explícito, o tom-base é o tom resolvido do CifraClub para evitar falso alerta.
  const sourceTone = hasExplicitKeyInCipherUrl && lookupSourceTone
    ? lookupSourceTone
    : (song?.tone ?? lookupSourceTone ?? null)
  
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
    setLookupSourceTone(null)

    if (song) {
      const songTone = song.tone || 'C'
      setFormData({
        title: song.title || '',
        artist: song.artist || '',
        tone: songTone,
        cipher_url: song.cipher_url || '',
        youtube_url: song.youtube_url || '',
        cifra_content: song.cifra_content ?? null,
      })

      // Estado inicial até carregar os tons oficiais do CifraClub.
      setAvailableTones([songTone])
      return
    }

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
        const keyParam = parsed.key != null ? `&key=${parsed.key}` : ''
        const res = await fetch(`/api/cifraclub?artist=${encodeURIComponent(parsed.artist)}&song=${encodeURIComponent(parsed.song)}${versionParam}${keyParam}`)
        if (!res.ok) return
        const data: CifraClubSong = await res.json()
        if (cancelled) return

        const scraperTones = data.available_tones?.filter((t) => /^[A-G](?:#|b)?m?$/.test(t)) ?? []
        if (scraperTones.length > 0) {
          setAvailableTones(scraperTones)

          const officialTone = (data.tone ?? '').trim()
          if (parsed.key != null && officialTone && scraperTones.includes(officialTone)) {
            setLookupSourceTone(officialTone)
          }

          // Garante que o tom selecionado fique sempre dentro da lista oficial do CifraClub.
          setFormData(prev => {
            if (scraperTones.includes(prev.tone)) return prev
            const nextTone = officialTone && scraperTones.includes(officialTone)
              ? officialTone
              : scraperTones[0]
            return nextTone ? { ...prev, tone: nextTone } : prev
          })
        }

        // If the song has no saved cifra, populate it now from the scraper
        if (!song.cifra_content && data.cifra && data.cifra.length > 0) {
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
   * Parse a CifraClub URL and return { artist, song, version?, key? }.
   * Accepts:
   * - https://www.cifraclub.com.br/artist-slug/song-slug/
   * - https://www.cifraclub.com.br/artist-slug/song-slug/simplificada.html
   */
  const parseCifraClubUrl = (input: string): { artist: string; song: string; version?: string; key?: number } | null => {
    try {
      const url = new URL(input.trim())
      const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
      if (parts.length >= 2) {
        const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
        const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
        const hashParams = new URLSearchParams(hash)
        const rawKey = hashParams.get('key')
        const parsedKey = rawKey == null ? undefined : Number(rawKey)
        const key = parsedKey != null && Number.isInteger(parsedKey) && parsedKey >= 0 ? parsedKey : undefined
        return { artist: parts[0], song: parts[1], version, key }
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
      const keyParam = parsed.key != null ? `&key=${parsed.key}` : ''
      const res = await fetch(`/api/cifraclub?artist=${encodeURIComponent(parsed.artist)}&song=${encodeURIComponent(parsed.song)}${versionParam}${keyParam}`)
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

      setAvailableTones(scraperTones)
      setLookupSourceTone(finalTone)

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
    // Regex mais robusto: captura acordes com extensões (7, 9, 11, 13, etc), diminutos, aumentados, etc
    const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

    const isLikelyChordLine = (line: string) => {
      const regex = new RegExp(chordRe)
      const matches = [...line.matchAll(regex)]
      if (matches.length >= 2) return true
      if (matches.length === 1 && line.trim() === matches[0][0]) return true
      return false
    }

    return lines.map(line => {
      if (!isLikelyChordLine(line)) return line
      return line.replace(chordRe, (token) => transposeChordSymbol(token, semitones))
    })
  }

  /**
   * Extract unique chord roots from a list of lines and return all possible tones.
   * Builds both major and minor versions for each unique root note.
   */
  const extractAvailableTones = (lines: string[], fallbackTone?: string): string[] => {
    const roots = new Set<string>()
    // Regex robusto que captura todos os tipos de acordes
    const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug|\+|°)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g
    
    lines.forEach(line => {
      let match
      while ((match = chordRe.exec(line)) !== null) {
        const chord = match[1]
        const root = parseToneRoot(chord)
        if (root) roots.add(root)
      }
    })

    if (roots.size === 0) return [fallbackTone || 'C']

    const allTones: string[] = []
    roots.forEach(root => {
      allTones.push(root)
      allTones.push(`${root}m`)
    })

    return allTones
      .filter(tone => TONES.includes(tone as any))
      .sort((a, b) => TONES.indexOf(a as any) - TONES.indexOf(b as any))
  }

  /**
   * Get currently available tones for display in select.
   */
  const getAvailableTones = (): string[] => {
    return availableTones.length > 0 ? availableTones : ['C']
  }

  // youtube_url is optional — do not block save if scraper couldn't find it
  const isLookupReady = Boolean(
    formData.title.trim() &&
    formData.artist.trim() &&
    formData.cipher_url.trim() &&
    formData.cifra_content &&
    formData.cifra_content.length > 0
  )

  const selectedTone = (formData.tone || sourceTone || 'C').trim()

  const willTranspose = Boolean(
    sourceTone &&
    selectedTone &&
    formData.cifra_content &&
    sourceTone !== selectedTone
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
    const shouldTranspose = Boolean(formData.cifra_content && sourceTone && sourceTone !== selectedTone)
    const sourceToneForTranspose = sourceTone ?? selectedTone
    
    let normalizedCifraContent =
      shouldTranspose && formData.cifra_content
        ? transposeCifra(formData.cifra_content, sourceToneForTranspose, selectedTone)
        : formData.cifra_content

    // Prefer API-transposed content when we have a CifraClub URL.
    const parsedFromCipherUrl = parseCifraClubUrl(normalizedCipherUrl)
    if (parsedFromCipherUrl) {
      try {
        const versionParam = parsedFromCipherUrl.version ? `&version=${encodeURIComponent(parsedFromCipherUrl.version)}` : ''
        const keyParam = parsedFromCipherUrl.key != null ? `&key=${parsedFromCipherUrl.key}` : ''
        const targetToneParam = `&target_tone=${encodeURIComponent(selectedTone)}`
        const res = await fetch(`/api/cifraclub?artist=${encodeURIComponent(parsedFromCipherUrl.artist)}&song=${encodeURIComponent(parsedFromCipherUrl.song)}${versionParam}${keyParam}${targetToneParam}`)
        if (res.ok) {
          const data: CifraClubSong = await res.json()
          if (data.cifra && data.cifra.length > 0) {
            normalizedCifraContent = data.cifra
          }
        }
      } catch {
        // Fallback to local transposition if API call fails.
      }
    }

    try {
      if (song) {
        const { error } = await supabase
          .from('songs')
          .update({
            title: normalizedTitle,
            artist: normalizedArtist,
            tone: selectedTone,
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
          tone: selectedTone,
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
              value={selectedTone}
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
            <Alert className="py-2 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <AlertDescription className="text-xs text-blue-900 dark:text-blue-100">
                ✓ Cifra será transposta de <strong>{sourceTone}</strong> para <strong>{selectedTone}</strong> ao salvar.
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
