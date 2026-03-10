'use client'

import { useEffect, useState, useCallback } from 'react'
import { Song, Minister, RepertoireItem } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { DeleteDialog } from '@/components/delete-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  Plus,
  ListMusic,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Music,
  User,
  Trash2,
  Youtube,
  FileText,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

type ServiceType = 'thursday' | 'sunday'

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
  const [formOpen, setFormOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<RepertoireItem | null>(null)
  const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    song_id: '',
    minister_id: '',
  })

  const fetchData = useCallback(async () => {
    const supabase = createClient()

    const [songsRes, ministersRes, repertoireRes] = await Promise.all([
      supabase.from('songs').select('*').order('title'),
      supabase.from('ministers').select('*').order('name'),
      supabase
        .from('repertoire')
        .select('*, song:songs(*), minister:ministers(*)')
        .eq('event_date', selectedDate)
        .order('order_index'),
    ])

    if (songsRes.data) setSongs(songsRes.data)
    if (ministersRes.data) setMinisters(ministersRes.data)
    if (repertoireRes.data) setRepertoire(repertoireRes.data)
    setLoading(false)
  }, [selectedDate])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    checkUserRole()
  }, [])

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

  const handleAddToRepertoire = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!isCultDay(selectedDate)) {
      setFormError('O repertório só pode ser criado para cultos de quinta ou domingo.')
      return
    }

    if (!isAdmin && !currentMinister) {
      setFormError('Não foi possível identificar o ministro logado.')
      return
    }
    const supabase = createClient()

    const maxOrder =
      repertoire.length > 0
        ? Math.max(...repertoire.map((r) => r.order_index))
        : 0

    const { error } = await supabase.from('repertoire').insert({
      song_id: formData.song_id,
      minister_id: isAdmin ? (formData.minister_id || null) : currentMinister?.id,
      event_date: selectedDate,
      order_index: maxOrder + 1,
    })

    if (error) {
      console.error('Erro ao adicionar ao repertório:', error)
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
    const { error } = await supabase
      .from('repertoire')
      .delete()
      .eq('id', deletingItem.id)

    if (error) throw error
    await fetchData()
  }

  const formattedDate = format(new Date(selectedDate + 'T12:00:00'), "EEEE, d 'de' MMMM", {
    locale: ptBR,
  })

  const selectedDateObj = fromDateInputValue(selectedDate)

  const handleSelectService = (service: ServiceType) => {
    setSelectedService(service)
    const date = getServiceDateInWeek(selectedDateObj, service)
    setSelectedDate(toDateInputValue(date))
    setLoading(true)
  }

  const handleChangeWeek = (direction: 'prev' | 'next') => {
    const date = new Date(selectedDateObj)
    date.setDate(date.getDate() + (direction === 'next' ? 7 : -7))
    const serviceDate = getServiceDateInWeek(date, selectedService)
    setSelectedDate(toDateInputValue(serviceDate))
    setLoading(true)
  }

  const availableSongs = songs.filter(
    (song) =>
      !repertoire.some((r) => r.song_id === song.id) &&
      (isAdmin || song.minister_id === currentMinister?.id)
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Repertório</h1>
            <p className="text-sm text-muted-foreground">
              Organize as músicas para cada culto
            </p>
          </div>

          <Button
            onClick={() => {
              if (!isAdmin && currentMinister) {
                setFormData({ song_id: '', minister_id: currentMinister.id })
              }
              setFormOpen(true)
            }}
            disabled={availableSongs.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar Música
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium text-foreground">Culto:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={selectedService === 'thursday' ? 'default' : 'outline'}
                onClick={() => handleSelectService('thursday')}
              >
                Quinta
              </Button>
              <Button
                type="button"
                variant={selectedService === 'sunday' ? 'default' : 'outline'}
                onClick={() => handleSelectService('sunday')}
              >
                Domingo
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleChangeWeek('prev')}
                aria-label="Semana anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleChangeWeek('next')}
                aria-label="Próxima semana"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Badge variant="secondary" className="capitalize">
              {selectedService === 'thursday' ? 'Culto de Quinta' : 'Culto de Domingo'}
            </Badge>
            <span className="text-sm capitalize text-muted-foreground">
              {formattedDate}
            </span>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        ) : repertoire.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <ListMusic className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-foreground">
              Nenhuma música no repertório
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Adicione músicas para este dia.
            </p>
            <Button onClick={() => setFormOpen(true)} disabled={availableSongs.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Música
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {repertoire.map((item, index) => (
              <Card key={item.id} className="transition-all hover:shadow-md">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
                      {index + 1}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">
                          {item.song?.title}
                        </h3>
                        <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                          {item.song?.tone}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Music className="h-3 w-3" />
                          {item.song?.artist}
                        </span>
                        {item.minister && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {item.minister.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {item.song?.cipher_url && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={item.song.cipher_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir cifra"
                            aria-label="Abrir cifra"
                          >
                            <FileText className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {item.song?.youtube_url && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={item.song.youtube_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir YouTube"
                            aria-label="Abrir YouTube"
                          >
                            <Youtube className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {(isAdmin || item.minister_id === currentMinister?.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeletingItem(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar ao Repertório</DialogTitle>
            <DialogDescription>
              Selecione uma música para adicionar ao culto de {formattedDate}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddToRepertoire} className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="song">Música</Label>
              <Select
                value={formData.song_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, song_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma música" />
                </SelectTrigger>
                <SelectContent>
                  {availableSongs.map((song) => (
                    <SelectItem key={song.id} value={song.id}>
                      {song.title} - {song.artist} ({song.tone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label htmlFor="minister">Ministro (opcional)</Label>
                <Select
                  value={formData.minister_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, minister_id: value })
                  }
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!formData.song_id}>
                Adicionar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deletingItem}
        onOpenChange={(open) => !open && setDeletingItem(null)}
        title="Remover do Repertório"
        description={`Tem certeza que deseja remover "${deletingItem?.song?.title}" do repertório?`}
        onConfirm={handleDeleteItem}
      />
    </div>
  )
}
