'use client'

import { useEffect, useState, useCallback } from 'react'
import { Song, Minister, RepertoireItem } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Music,
  Trash2,
  Youtube,
  FileText,
  ListMusic,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = 'thursday' | 'sunday'
type ScheduleMode = 'recurring' | 'special'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRecurringEventName(serviceType: ServiceType) {
  return serviceType === 'thursday' ? 'Culto de Quinta' : 'Culto de Domingo'
}

function toDateInputValue(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function fromDateInputValue(value: string) {
  return new Date(`${value}T12:00:00`)
}

function getNextWeekday(baseDate: Date, weekday: number) {
  const date = new Date(baseDate)
  const currentDay = date.getDay()
  const diff = (weekday - currentDay + 7) % 7
  date.setDate(date.getDate() + diff)
  return date
}

function getNearestServiceDate(baseDate: Date) {
  const nextThursday = getNextWeekday(baseDate, 4)
  const nextSunday = getNextWeekday(baseDate, 0)
  return nextThursday <= nextSunday ? nextThursday : nextSunday
}

function getServiceTypeFromDate(date: Date): ServiceType {
  return date.getDay() === 4 ? 'thursday' : 'sunday'
}

function getServiceDateInWeek(anchorDate: Date, serviceType: ServiceType) {
  const date = new Date(anchorDate)
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  date.setDate(date.getDate() - diffToMonday)
  const offset = serviceType === 'thursday' ? 3 : 6
  date.setDate(date.getDate() + offset)
  return date
}

function isCultDay(dateValue: string) {
  const day = fromDateInputValue(dateValue).getDay()
  return day === 4 || day === 0
}

function getWeekLabel(date: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const monday = (d: Date) => {
    const copy = new Date(d)
    copy.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    copy.setHours(0, 0, 0, 0)
    return copy
  }

  const thisMonday = monday(today)
  const targetMonday = monday(date)
  const diff = Math.round(
    (targetMonday.getTime() - thisMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)
  )

  if (diff === 0) return 'Esta semana'
  if (diff === 1) return 'Próxima semana'
  if (diff === -1) return 'Semana passada'
  return diff > 0 ? `Em ${diff} semanas` : `Há ${Math.abs(diff)} semanas`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RepertorioPage() {
  const initialServiceDate = getNearestServiceDate(new Date())

  const [repertoire, setRepertoire] = useState<RepertoireItem[]>([])
  const [songs, setSongs] = useState<Song[]>([])
  const [ministers, setMinisters] = useState<Minister[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>(toDateInputValue(initialServiceDate))
  const [selectedService, setSelectedService] = useState<ServiceType>(
    getServiceTypeFromDate(initialServiceDate)
  )
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('recurring')
  const [specialEventName, setSpecialEventName] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<RepertoireItem | null>(null)
  const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formData, setFormData] = useState({ song_id: '', minister_id: '' })

  const selectedDateObj = fromDateInputValue(selectedDate)

  const selectedEventName =
    scheduleMode === 'recurring'
      ? getRecurringEventName(selectedService)
      : specialEventName.trim()

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const supabase = createClient()

    let repertoireQuery = supabase
      .from('repertoire')
      .select('*, song:songs(*), minister:ministers(*)')
      .eq('event_date', selectedDate)
      .order('order_index')

    if (selectedEventName) {
      repertoireQuery = repertoireQuery.eq('event_name', selectedEventName)
    }

    const [songsRes, ministersRes, repertoireRes] = await Promise.all([
      supabase.from('songs').select('*').order('title'),
      supabase.from('ministers').select('*').order('name'),
      repertoireQuery,
    ])

    if (songsRes.data) setSongs(songsRes.data)
    if (ministersRes.data) setMinisters(ministersRes.data)
    if (repertoireRes.data) setRepertoire(repertoireRes.data)
    setLoading(false)
  }, [selectedDate, selectedEventName])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => { checkUserRole() }, [])

  const checkUserRole = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const { data: minister } = await supabase
        .from('ministers')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (minister) {
        setCurrentMinister(minister)
        setIsAdmin(minister.role === 'admin')
      }
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddToRepertoire = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (scheduleMode === 'recurring' && !isCultDay(selectedDate)) {
      setFormError('O repertório só pode ser criado para cultos de quinta ou domingo.')
      return
    }
    if (scheduleMode === 'special' && !selectedEventName) {
      setFormError('Informe o nome do evento especial para continuar.')
      return
    }
    if (!isAdmin && !currentMinister) {
      setFormError('Não foi possível identificar o ministro logado.')
      return
    }

    const supabase = createClient()
    const maxOrder = repertoire.length > 0
      ? Math.max(...repertoire.map((r) => r.order_index))
      : 0

    const { error } = await supabase.from('repertoire').insert({
      song_id: formData.song_id,
      minister_id: isAdmin ? (formData.minister_id || null) : currentMinister?.id,
      event_name: selectedEventName,
      event_date: selectedDate,
      order_index: maxOrder + 1,
    })

    if (error) {
      setFormError(error.message || 'Erro ao adicionar ao repertório.')
      return
    }

    setFormOpen(false)
    setFormData({ song_id: '', minister_id: '' })
    fetchData()
  }

  const handleDeleteItem = async () => {
    if (!deletingItem) return
    if (!isAdmin && deletingItem.minister_id !== currentMinister?.id) return

    const supabase = createClient()
    const { error } = await supabase.from('repertoire').delete().eq('id', deletingItem.id)
    if (error) throw error
    setDeletingItem(null)
    await fetchData()
  }

  const handleSelectService = (service: ServiceType) => {
    setScheduleMode('recurring')
    setSelectedService(service)
    const date = getServiceDateInWeek(selectedDateObj, service)
    setSelectedDate(toDateInputValue(date))
    setLoading(true)
  }

  const handleSwitchMode = (mode: ScheduleMode) => {
    setScheduleMode(mode)
    setFormError(null)
    if (mode === 'recurring') {
      const nearestServiceDate = getNearestServiceDate(selectedDateObj)
      const service = getServiceTypeFromDate(nearestServiceDate)
      setSelectedService(service)
      setSelectedDate(toDateInputValue(nearestServiceDate))
      setSpecialEventName('')
      setLoading(true)
    }
  }

  const handleChangeWeek = (direction: 'prev' | 'next') => {
    const date = new Date(selectedDateObj)
    date.setDate(date.getDate() + (direction === 'next' ? 7 : -7))
    const serviceDate = getServiceDateInWeek(date, selectedService)
    setSelectedDate(toDateInputValue(serviceDate))
    setLoading(true)
  }

  const handleOpenAddForm = () => {
    if (!isAdmin && currentMinister) {
      setFormData({ song_id: '', minister_id: currentMinister.id })
    } else {
      setFormData({ song_id: '', minister_id: '' })
    }
    setFormOpen(true)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const availableSongs = songs.filter(
    (song) =>
      !repertoire.some((r) => r.song_id === song.id) &&
      (isAdmin || song.minister_id === currentMinister?.id)
  )

  const formattedDate = format(
    fromDateInputValue(selectedDate),
    "EEEE, d 'de' MMMM",
    { locale: ptBR }
  )

  const weekLabel = getWeekLabel(selectedDateObj)

  const eventContextLabel = scheduleMode === 'special'
    ? (specialEventName.trim() || 'Evento Especial')
    : getRecurringEventName(selectedService)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-9">

        {/* ── Header ── */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Repertório</h1>
            <p className="text-sm text-muted-foreground">Músicas para o próximo culto</p>
          </div>
          <Button onClick={handleOpenAddForm} disabled={availableSongs.length === 0}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar
          </Button>
        </div>

        {/* ── Service tabs ── */}
        <div className="mb-3 flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {(['thursday', 'sunday'] as ServiceType[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSelectService(s)}
              className={[
                'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
                scheduleMode === 'recurring' && selectedService === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {s === 'thursday' ? 'Quinta-feira' : 'Domingo'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleSwitchMode(scheduleMode === 'special' ? 'recurring' : 'special')}
            className={[
              'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
              scheduleMode === 'special'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            Especial
          </button>
        </div>

        {/* ── Special event fields ── */}
        {scheduleMode === 'special' && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="special-name">Nome do evento</Label>
              <Input
                id="special-name"
                placeholder="Ex.: Conferência Jovem"
                value={specialEventName}
                onChange={(e) => {
                  setSpecialEventName(e.target.value)
                  setLoading(true)
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="special-date">Data do evento</Label>
              <Input
                id="special-date"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value)
                  setLoading(true)
                }}
              />
            </div>
          </div>
        )}

        {/* ── Week navigator ── */}
        {scheduleMode === 'recurring' && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleChangeWeek('prev')}
              aria-label="Semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">{weekLabel}</p>
              <p className="text-xs capitalize text-muted-foreground">{formattedDate}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleChangeWeek('next')}
              aria-label="Próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* ── Count label ── */}
        {!loading && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {repertoire.length} {repertoire.length === 1 ? 'música' : 'músicas'} · {eventContextLabel}
          </p>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-8 w-8" />
          </div>
        ) : repertoire.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 rounded-2xl bg-muted p-5">
              <ListMusic className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-foreground">
              Nenhuma música ainda
            </h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Adicione músicas para {eventContextLabel.toLowerCase()}.
            </p>
            <Button onClick={handleOpenAddForm} disabled={availableSongs.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar música
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {repertoire.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-shadow hover:shadow-sm"
              >
                {/* Order number */}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                  {index + 1}
                </span>

                {/* Song info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">
                      {item.song?.title}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {item.song?.tone}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.song?.artist}
                    {item.minister && (
                      <> · <span>{item.minister.name}</span></>
                    )}
                  </p>
                  {scheduleMode === 'special' && item.event_name && (
                    <span className="mt-1 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                      {item.event_name}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center">
                  {item.song?.cipher_url && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={item.song.cipher_url} target="_blank" rel="noopener noreferrer" title="Abrir cifra">
                        <FileText className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {item.song?.youtube_url && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={item.song.youtube_url} target="_blank" rel="noopener noreferrer" title="Abrir YouTube">
                        <Youtube className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {(isAdmin || item.minister_id === currentMinister?.id) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeletingItem(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Add dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar ao Repertório</DialogTitle>
            <DialogDescription className="capitalize">
              {eventContextLabel} · {formattedDate}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddToRepertoire} className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Música</Label>
              <Select
                value={formData.song_id}
                onValueChange={(value) => setFormData({ ...formData, song_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma música" />
                </SelectTrigger>
                <SelectContent>
                  {availableSongs.map((song) => (
                    <SelectItem key={song.id} value={song.id}>
                      {song.title} — {song.artist} ({song.tone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label>Ministro <span className="text-muted-foreground">(opcional)</span></Label>
                <Select
                  value={formData.minister_id}
                  onValueChange={(value) => setFormData({ ...formData, minister_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um ministro" />
                  </SelectTrigger>
                  <SelectContent>
                    {ministers.map((minister) => (
                      <SelectItem key={minister.id} value={minister.id}>
                        {minister.name} ({minister.instrument})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!formData.song_id}>
                Adicionar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ── */}
      <AlertDialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover do Repertório</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover "{deletingItem?.song?.title}" do repertório?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}