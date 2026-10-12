'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Song, Minister, RepertoireItem } from '@/lib/types'
import { hasLeadVoiceRole } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/client'
import { openPdfCifraInSystemBrowserFromUserGesture } from '@/lib/open-cifra-pdf-browser'
import { Header } from '@/components/header'
import { CifraViewer } from '@/components/cifra-viewer'
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
    Trash2,
    Pencil,
    Lock,
    Unlock,
    ArrowUp,
    ArrowDown,
    Play,
    EllipsisVertical,
    Youtube,
    FileText,
    ListMusic,
    Sparkles,
    CalendarDays,
    Share,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationPrevious,
    PaginationNext,
} from '@/components/ui/pagination'
import {
    format,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    getDay,
    addWeeks,
    subWeeks,
    isToday,
    isSameDay,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = 'thursday' | 'sunday' | 'special'

interface SpecialEvent {
    id: string
    name: string
    event_date: string
    created_by: string | null
}

interface DayInfo {
    date: Date
    isThursday: boolean
    isSunday: boolean
    specialEvents: SpecialEvent[]
}

interface SelectedDay {
    date: Date
    serviceType: ServiceType
    eventName: string
    specialEventId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(date: Date) {
    return format(date, 'yyyy-MM-dd')
}

function fromDateStr(value: string) {
    return new Date(`${value}T12:00:00`)
}

function getRecurringEventName(date: Date) {
    return getDay(date) === 4 ? 'Culto de Quinta' : 'Culto de Domingo'
}

function getWeekdayShortLabel(date: Date) {
    const labels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
    return labels[getDay(date)]
}

function getWeekDays(anchor: Date): Date[] {
    const start = startOfWeek(anchor, { weekStartsOn: 1 })
    const end = endOfWeek(anchor, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
}

function getWeekLabel(anchor: Date): string {
    const today = new Date()
    const thisMonday = startOfWeek(today, { weekStartsOn: 1 })
    const anchorMonday = startOfWeek(anchor, { weekStartsOn: 1 })
    const diff = Math.round(
        (anchorMonday.getTime() - thisMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)
    )
    if (diff === 0) return 'Esta semana'
    if (diff === 1) return 'Próxima semana'
    if (diff === -1) return 'Semana passada'
    return diff > 0 ? `Em ${diff} semanas` : `Há ${Math.abs(diff)} semanas`
}

// ─── Week Day Cell ─────────────────────────────────────────────────────────────

function WeekDayCell({
    date,
    info,
    selectedDay,
    onSelect,
}: {
    date: Date
    info?: DayInfo
    selectedDay: SelectedDay | null
    onSelect: (day: SelectedDay) => void
}) {
    const dow = getDay(date)
    const isFixed = dow === 4 || dow === 0
    const hasSpecial = (info?.specialEvents.length ?? 0) > 0
    const isClickable = isFixed || hasSpecial
    const today = isToday(date)
    const isSelected = selectedDay ? isSameDay(date, selectedDay.date) : false

    const handleClick = () => {
        if (!isClickable) return
        if (isFixed) {
            onSelect({ date, serviceType: dow === 4 ? 'thursday' : 'sunday', eventName: getRecurringEventName(date) })
        } else {
            onSelect({ date, serviceType: 'special', eventName: info!.specialEvents[0].name, specialEventId: info!.specialEvents[0].id })
        }
    }

    const selectedBg = isSelected
        ? selectedDay?.serviceType === 'special' ? 'bg-amber-400 text-amber-950'
            : dow === 4 ? 'bg-blue-600 text-white'
                : 'bg-violet-600 text-white'
        : ''

    const dotColor = dow === 4 ? 'bg-blue-500' : dow === 0 ? 'bg-violet-500' : 'bg-amber-400'

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={!isClickable}
            className={[
                'relative flex flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 transition-all select-none sm:px-1 sm:py-2.5',
                isClickable ? 'cursor-pointer' : 'cursor-default',
                isSelected ? `${selectedBg} shadow-md` : isClickable ? 'hover:bg-muted' : 'opacity-25',
            ].join(' ')}
        >
            <span className={[
                'text-[10px] font-semibold uppercase tracking-wider',
                isSelected ? 'opacity-80' : 'text-muted-foreground',
            ].join(' ')}>
                {getWeekdayShortLabel(date)}
            </span>

            <span className={[
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold sm:h-8 sm:w-8 sm:text-sm',
                today && !isSelected ? 'ring-2 ring-foreground/40 bg-foreground/10' : '',
            ].join(' ')}>
                {format(date, 'd')}
            </span>

            {!isSelected && isClickable && (
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
            )}

            {/* Special badge on top of a fixed day */}
            {hasSpecial && isFixed && !isSelected && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400">
                    <Sparkles className="h-2 w-2 text-amber-950" />
                </span>
            )}

            {/* Count badge for pure-special days with multiple events */}
            {hasSpecial && !isFixed && !isSelected && (info?.specialEvents.length ?? 0) > 1 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950">
                    {info!.specialEvents.length}
                </span>
            )}
        </button>
    )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function RepertorioPage() {
    const router = useRouter()
    const [weekAnchor, setWeekAnchor] = useState(new Date())
    const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null)
    const [dayInfoMap, setDayInfoMap] = useState<Record<string, DayInfo>>({})
    const [selectedCifraSong, setSelectedCifraSong] = useState<Song | null>(null)

    const [repertoire, setRepertoire] = useState<RepertoireItem[]>([])
    const [totalRepertoire, setTotalRepertoire] = useState(0)
    const [page, setPage] = useState(1)
    const [songs, setSongs] = useState<Song[]>([])
    const [ministers, setMinisters] = useState<Minister[]>([])
    const [specialEvents, setSpecialEvents] = useState<SpecialEvent[]>([])
    const [loading, setLoading] = useState(false)
    const [weekLoading, setWeekLoading] = useState(true)

    const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
    const [effectiveChurchId, setEffectiveChurchId] = useState<string | null>(null)
    const [isAdmin, setIsAdmin] = useState(false)
    const isSinger = hasLeadVoiceRole(currentMinister?.instrument)
    const canAddSongsToRepertoire = isAdmin || isSinger
    const isMedia = currentMinister?.role === 'midia'

    const [formOpen, setFormOpen] = useState(false)
    const [deletingItem, setDeletingItem] = useState<RepertoireItem | null>(null)
    const [deletingEvent, setDeletingEvent] = useState<SpecialEvent | null>(null)
    const [createEventOpen, setCreateEventOpen] = useState(false)
    const [editingEvent, setEditingEvent] = useState<SpecialEvent | null>(null)
    const [editEventName, setEditEventName] = useState('')
    const [editEventError, setEditEventError] = useState<string | null>(null)
    const [reorderEnabled, setReorderEnabled] = useState(false)
    const [reorderError, setReorderError] = useState<string | null>(null)
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    const [formData, setFormData] = useState({ song_id: '', minister_id: '' })
    const [formError, setFormError] = useState<string | null>(null)
    const [newEventName, setNewEventName] = useState('')
    const [newEventDate, setNewEventDate] = useState('')
    const [newEventError, setNewEventError] = useState<string | null>(null)

    // ── Init ───────────────────────────────────────────────────────────────────

    useEffect(() => {
        checkUserRole()
        const nearest = getNearestServiceDay(new Date())
        if (nearest) { setSelectedDay(nearest); setWeekAnchor(nearest.date) }
    }, [])

    function getNearestServiceDay(from: Date): SelectedDay | null {
        for (let i = 0; i < 14; i++) {
            const d = new Date(from)
            d.setDate(d.getDate() + i)
            const day = getDay(d)
            if (day === 4) return { date: d, serviceType: 'thursday', eventName: 'Culto de Quinta' }
            if (day === 0) return { date: d, serviceType: 'sunday', eventName: 'Culto de Domingo' }
        }
        return null
    }

    // ── Auth ───────────────────────────────────────────────────────────────────

    const checkUserRole = async () => {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data: minister } = await supabase.from('ministers').select('*').eq('user_id', user.id).single()
            if (minister) { setCurrentMinister(minister); setIsAdmin(minister.role === 'admin') }
        }

        const contextResponse = await fetch('/api/context')
        if (contextResponse.ok) {
            const result = await contextResponse.json()
            setEffectiveChurchId(result.context?.churchId ?? null)
            if (result.context?.isImpersonating) setIsAdmin(true)
        }
    }

    // ── Special events + day info ──────────────────────────────────────────────

    const fetchSpecialEvents = useCallback(async () => {
        if (!effectiveChurchId) return [] as SpecialEvent[]

        const supabase = createClient()
        const { data } = await supabase
            .from('special_events')
            .select('*')
            .eq('church_id', effectiveChurchId)
            .order('event_date')
        if (data) { setSpecialEvents(data); return data }
        return [] as SpecialEvent[]
    }, [effectiveChurchId])

    const buildDayInfoMap = useCallback((events: SpecialEvent[], days: Date[]) => {
        setDayInfoMap(prev => {
            const map = { ...prev }
            for (const d of days) {
                const key = toDateStr(d)
                const dow = getDay(d)
                map[key] = { date: d, isThursday: dow === 4, isSunday: dow === 0, specialEvents: events.filter(e => e.event_date === key) }
            }
            return map
        })
        setWeekLoading(false)
    }, [])

    useEffect(() => {
        if (!currentMinister) return
        setWeekLoading(true)
        const days = getWeekDays(weekAnchor)
        fetchSpecialEvents().then(events => buildDayInfoMap(events, days))
    }, [weekAnchor, currentMinister, fetchSpecialEvents, buildDayInfoMap])

    // ── Repertoire ─────────────────────────────────────────────────────────────

    const fetchRepertoire = useCallback(async () => {
        if (!selectedDay || !currentMinister || !effectiveChurchId) return
        setLoading(true)
        const supabase = createClient()
        const [songsRes, ministersRes, repRes, repCountRes] = await Promise.all([
            supabase.from('songs').select('*').eq('church_id', effectiveChurchId).order('title'),
            supabase.from('ministers').select('*').eq('church_id', effectiveChurchId).order('name'),
            supabase.from('repertoire')
                .select('*, song:songs(*), minister:ministers(*)', { count: 'exact' })
                .eq('church_id', effectiveChurchId)
                .eq('event_date', toDateStr(selectedDay.date))
                .eq('event_name', selectedDay.eventName)
                .order('order_index')
                .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
            supabase.from('repertoire')
                .select('id', { count: 'exact', head: true })
                .eq('church_id', effectiveChurchId)
                .eq('event_date', toDateStr(selectedDay.date))
                .eq('event_name', selectedDay.eventName),
        ])
        if (songsRes.data) setSongs(songsRes.data)
        if (ministersRes.data) setMinisters(ministersRes.data)
        if (repRes.data) setRepertoire(repRes.data)
        setTotalRepertoire(repCountRes.count || 0)
        setLoading(false)
    }, [selectedDay, page, currentMinister, effectiveChurchId])

    useEffect(() => { if (selectedDay) fetchRepertoire() }, [fetchRepertoire, selectedDay, page])

    // ── Handlers ───────────────────────────────────────────────────────────────

    const handleWeekChange = (dir: 'prev' | 'next') =>
        setWeekAnchor(a => dir === 'next' ? addWeeks(a, 1) : subWeeks(a, 1))

    const handleAddToRepertoire = async (e: React.FormEvent) => {
        e.preventDefault()
        setFormError(null)
        if (!selectedDay) return
        if (!canAddSongsToRepertoire) {
            setFormError('Apenas administradores e usuários com a função Voz podem adicionar músicas ao repertório.')
            return
        }
        if (isAdmin && !formData.minister_id) {
            setFormError('Selecione o ministro para carregar e adicionar as músicas dele.')
            return
        }
        if (!currentMinister || !effectiveChurchId) { setFormError('Não foi possível identificar a igreja atual.'); return }
        const supabase = createClient()
        const maxOrder = repertoire.length > 0 ? Math.max(...repertoire.map(r => r.order_index)) : 0
        const { error } = await supabase.from('repertoire').insert({
            church_id: effectiveChurchId,
            song_id: formData.song_id,
            minister_id: isAdmin ? (formData.minister_id || null) : currentMinister?.id,
            event_name: selectedDay.eventName,
            event_date: toDateStr(selectedDay.date),
            order_index: maxOrder + 1,
        })
        if (error) { setFormError(error.message || 'Erro ao adicionar.'); return }
        setFormOpen(false)
        setFormData({ song_id: '', minister_id: '' })
        fetchRepertoire()
    }

    const handleDeleteItem = async () => {
        if (!deletingItem || !effectiveChurchId) return
        if (!(isAdmin || isSinger)) {
            setDeletingItem(null)
            return
        }
        await createClient()
            .from('repertoire')
            .delete()
            .eq('id', deletingItem.id)
            .eq('church_id', effectiveChurchId)
        setDeletingItem(null)
        fetchRepertoire()
    }

    const handleDeleteEvent = async () => {
        if (!deletingEvent || !effectiveChurchId) return
        const supabase = createClient()
        await supabase
            .from('repertoire')
            .delete()
            .eq('church_id', effectiveChurchId)
            .eq('event_name', deletingEvent.name)
            .eq('event_date', deletingEvent.event_date)
        await supabase
            .from('special_events')
            .delete()
            .eq('id', deletingEvent.id)
            .eq('church_id', effectiveChurchId)
        setDeletingEvent(null)
        if (selectedDay?.specialEventId === deletingEvent.id) setSelectedDay(getNearestServiceDay(new Date()))
        const events = await fetchSpecialEvents()
        buildDayInfoMap(events, getWeekDays(weekAnchor))
    }

    const handleRenameEvent = async (e: React.FormEvent) => {
        e.preventDefault()
        setEditEventError(null)
        if (!editingEvent || !effectiveChurchId) return
        if (!editEventName.trim()) { setEditEventError('Informe o nome do evento.'); return }
        const { error } = await createClient()
            .from('special_events')
            .update({ name: editEventName.trim() })
            .eq('id', editingEvent.id)
            .eq('church_id', effectiveChurchId)
        if (error) { setEditEventError(error.message); return }
        if (selectedDay?.specialEventId === editingEvent.id) {
            setSelectedDay(prev => prev ? { ...prev, eventName: editEventName.trim() } : prev)
        }
        setEditingEvent(null)
        const events = await fetchSpecialEvents()
        buildDayInfoMap(events, getWeekDays(weekAnchor))
    }

    const handleCreateEvent = async (e: React.FormEvent) => {
        e.preventDefault()
        setNewEventError(null)
        if (!newEventName.trim()) { setNewEventError('Informe o nome do evento.'); return }
        if (!newEventDate) { setNewEventError('Informe a data.'); return }
        if (!currentMinister || !effectiveChurchId) { setNewEventError('Não foi possível identificar a igreja atual.'); return }
        const { data, error } = await createClient().from('special_events').insert({ church_id: effectiveChurchId, name: newEventName.trim(), event_date: newEventDate, created_by: currentMinister.id }).select().single()
        if (error) { setNewEventError(error.message); return }
        setCreateEventOpen(false)
        setNewEventName('')
        setNewEventDate('')
        const newDate = fromDateStr(newEventDate)
        const events = await fetchSpecialEvents()
        setWeekAnchor(newDate)
        buildDayInfoMap(events, getWeekDays(newDate))
        setSelectedDay({ date: newDate, serviceType: 'special', eventName: data.name, specialEventId: data.id })
    }

    const handleOpenAddForm = () => {
        if (!canAddSongsToRepertoire) return
        setFormData({ song_id: '', minister_id: (!isAdmin && currentMinister) ? currentMinister.id : '' })
        setFormError(null)
        setFormOpen(true)
    }

    const handleOpenPlaylist = async () => {
        if (!selectedDay) return

        const params = new URLSearchParams({
            date: toDateStr(selectedDay.date),
            eventName: selectedDay.eventName,
        })

        router.push(`/repertoire/player?${params.toString()}`)
    }

    const handleExportWhatsapp = () => {
        if (!selectedDay) return
        if (!repertoire || repertoire.length === 0) {
            window.alert('Nenhuma música no repertório para exportar.')
            return
        }

        const dateLabel = format(selectedDay.date, 'dd/MM/yyyy')
        const header = `Repertório - ${selectedDay.eventName} (${dateLabel})`
        const lines = repertoire.map((item, idx) => {
            const title = item.song?.title ?? 'Sem título'
            const artist = item.song?.artist ?? 'Artista desconhecido'
            const tone = item.song?.tone ? ` (Tom ${item.song.tone}${item.song?.capo_frets && item.song.capo_frets > 0 ? ` · Capo ${item.song.capo_frets}ª` : ''})` : ''
            return `${idx + 1}. ${title} — ${artist}${tone}`
        })

        const message = [header, '', ...lines].join('\n')
        const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`
        window.open(waUrl, '_blank', 'noopener,noreferrer')
    }

    const saveRepertoireOrder = async (items: RepertoireItem[]) => {
        setReorderError(null)
        const supabase = createClient()
        const updates = items.map(item =>
            supabase
                .from('repertoire')
                .update({ order_index: item.order_index })
                .eq('id', item.id)
                .eq('church_id', effectiveChurchId)
        )
        const results = await Promise.all(updates)
        for (const result of results) {
            if (result.error) {
                setReorderError(result.error.message || 'Não foi possível salvar a nova ordem.')
                fetchRepertoire()
                return
            }
        }
    }

    const moveRepertoireItem = async (from: number, to: number) => {
        if (from === to || from < 0 || to < 0 || from >= repertoire.length || to >= repertoire.length) {
            return
        }

        const updated = [...repertoire]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        const normalized = updated.map((item, idx) => ({ ...item, order_index: idx + 1 }))

        setRepertoire(normalized)
        await saveRepertoireOrder(normalized)
    }

    const handleDragStart = (index: number) => {
        if (!reorderEnabled) return
        setDraggingIndex(index)
        setDragOverIndex(index)
        setReorderError(null)
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        if (!reorderEnabled || draggingIndex === null) return
        e.preventDefault()
        if (dragOverIndex !== index) setDragOverIndex(index)
    }

    const handleDrop = async (dropIndex: number) => {
        if (!reorderEnabled || draggingIndex === null) return

        const from = draggingIndex
        const to = dropIndex
        setDraggingIndex(null)
        setDragOverIndex(null)

        await moveRepertoireItem(from, to)
    }

    const handleDragEnd = () => {
        setDraggingIndex(null)
        setDragOverIndex(null)
    }



    // ── Derived ────────────────────────────────────────────────────────────────

    const weekDays = getWeekDays(weekAnchor)
    const weekLabel = getWeekLabel(weekAnchor)

    const availableSongs = songs.filter(
        s => !repertoire.some(r => r.song_id === s.id) && (isAdmin || s.minister_id === currentMinister?.id)
    )

    const filteredSongsForForm = availableSongs.filter((song) => {
        if (isAdmin && formData.minister_id && song.minister_id !== formData.minister_id) return false
        if (isAdmin && !formData.minister_id) return false
        return true
    })

    const selectedDayOptions = (() => {
        if (!selectedDay) return []
        const info = dayInfoMap[toDateStr(selectedDay.date)]
        const dow = getDay(selectedDay.date)
        const opts: { label: string; type: ServiceType; value: SelectedDay; specialEvent?: SpecialEvent }[] = []
        if (dow === 4 || dow === 0) {
            opts.push({ label: getRecurringEventName(selectedDay.date), type: dow === 4 ? 'thursday' : 'sunday', value: { date: selectedDay.date, serviceType: dow === 4 ? 'thursday' : 'sunday', eventName: getRecurringEventName(selectedDay.date) } })
        }
        info?.specialEvents.forEach(ev =>
            opts.push({ label: ev.name, type: 'special', value: { date: selectedDay.date, serviceType: 'special', eventName: ev.name, specialEventId: ev.id }, specialEvent: ev })
        )
        return opts
    })()

    const hasMultipleEvents = selectedDayOptions.length > 1
    const activeSpecialEvent = selectedDay?.serviceType === 'special'
        ? specialEvents.find(e => e.id === selectedDay.specialEventId)
        : undefined

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">

                {/* ── Page header ── */}
                <div className="mb-6 flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Repertório</h1>
                        <p className="text-sm text-muted-foreground">Selecione um dia abaixo</p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setNewEventDate(selectedDay ? toDateStr(selectedDay.date) : toDateStr(new Date())); setCreateEventOpen(true) }}
                        disabled={isMedia}
                        title={isMedia ? 'Usuários de mídia não podem criar eventos especiais.' : undefined}
                    >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        Evento especial
                    </Button>
                </div>

                {/* ── Week strip ── */}
                <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-background shadow-sm">

                    {/* Navigation header */}
                    <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2 sm:px-3">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleWeekChange('prev')}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="min-w-0 flex-1 px-1 text-center">
                            <p className="text-xs font-semibold text-foreground">{weekLabel}</p>
                            <p className="truncate text-[10px] text-muted-foreground">
                                {format(weekDays[0], 'd MMM', { locale: ptBR })} – {format(weekDays[6], "d MMM yyyy", { locale: ptBR })}
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleWeekChange('next')}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Day cells */}
                    <div className="px-1 py-2 sm:px-2">
                        <div className="grid grid-cols-7 gap-0.5">
                            {weekLoading
                                ? Array(7).fill(null).map((_, i) => (
                                    <div key={i} className="flex flex-col items-center gap-1 py-2">
                                        <div className="h-2 w-5 animate-pulse rounded bg-muted" />
                                        <div className="h-7 w-7 animate-pulse rounded-full bg-muted sm:h-8 sm:w-8" />
                                        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                                    </div>
                                ))
                                : weekDays.map(d => (
                                    <WeekDayCell
                                        key={toDateStr(d)}
                                        date={d}
                                        info={dayInfoMap[toDateStr(d)]}
                                        selectedDay={selectedDay}
                                        onSelect={setSelectedDay}
                                    />
                                ))
                            }
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Quinta
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Domingo
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Especial
                        </span>
                    </div>
                </div>

                {/* ── Content ── */}
                {!selectedDay ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
                        <CalendarDays className="mb-3 h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Selecione um dia acima</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">

                        {/* ── Multi-event pills ── */}
                        {hasMultipleEvents && (
                            <div className="flex flex-wrap gap-1.5">
                                {selectedDayOptions.map(opt => {
                                    const isActive = opt.value.eventName === selectedDay.eventName
                                    const pillCls =
                                        opt.type === 'special'
                                            ? isActive ? 'bg-amber-400 text-amber-950 border-amber-400' : 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30'
                                            : opt.type === 'thursday'
                                                ? isActive ? 'bg-blue-600 text-white border-blue-600' : 'border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/30'
                                                : isActive ? 'bg-violet-600 text-white border-violet-600' : 'border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950/30'
                                    return (
                                        <button key={opt.value.eventName} type="button" onClick={() => setSelectedDay(opt.value)}
                                            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${pillCls}`}>
                                            {opt.type === 'special' && <Sparkles className="h-3 w-3" />}
                                            {opt.label}
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                        {/* ── Day header card ── */}
                        <div className={[
                            'rounded-2xl border p-4 shadow-sm',
                            selectedDay.serviceType === 'special' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700'
                                : selectedDay.serviceType === 'thursday' ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800'
                                    : 'border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800',
                        ].join(' ')}>
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="flex items-center gap-2">
                                        {selectedDay.serviceType === 'special' && <Sparkles className="h-4 w-4 text-amber-500" />}
                                        <span className={[
                                            'text-xs font-semibold uppercase tracking-wider',
                                            selectedDay.serviceType === 'special' ? 'text-amber-600 dark:text-amber-400'
                                                : selectedDay.serviceType === 'thursday' ? 'text-blue-600 dark:text-blue-400'
                                                    : 'text-violet-600 dark:text-violet-400',
                                        ].join(' ')}>
                                            {selectedDay.serviceType === 'special' ? 'Evento especial'
                                                : selectedDay.serviceType === 'thursday' ? 'Quinta-feira' : 'Domingo'}
                                        </span>
                                    </div>
                                    {!hasMultipleEvents && (
                                        <h3 className="mt-0.5 font-bold text-foreground">{selectedDay.eventName}</h3>
                                    )}
                                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                                        {format(selectedDay.date, "EEEE, d 'de' MMMM", { locale: ptBR })}
                                    </p>
                                </div>
                                {(() => {
                                    const canManage = selectedDay.serviceType === 'special' && activeSpecialEvent &&
                                        (isAdmin || currentMinister?.id === activeSpecialEvent?.created_by)
                                    return canManage ? (
                                        <div className="flex shrink-0 items-center gap-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted"
                                                title="Renomear evento especial"
                                                onClick={() => { setEditingEvent(activeSpecialEvent!); setEditEventName(activeSpecialEvent!.name); setEditEventError(null) }}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                title="Excluir evento especial" onClick={() => setDeletingEvent(activeSpecialEvent!)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : null
                                })()}
                            </div>
                        </div>

                        {/* ── Count + add ── */}
                        <div className="flex items-center justify-between">
                            {!loading && (
                                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                    {repertoire.length} {repertoire.length === 1 ? 'música' : 'músicas'}
                                </p>
                            )}
                            <div className="flex items-center gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className="sm:hidden">
                                            <EllipsisVertical className="mr-1.5 h-3.5 w-3.5" />
                                            Ações
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onSelect={() => void handleOpenPlaylist()}>
                                            <Play className="mr-2 h-3.5 w-3.5" />
                                            Playlist
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            disabled={!(isAdmin || isSinger)}
                                            onSelect={() => {
                                                if (!(isAdmin || isSinger)) return
                                                setReorderEnabled((prev) => !prev)
                                                setDraggingIndex(null)
                                                setDragOverIndex(null)
                                                setReorderError(null)
                                            }}
                                        >
                                            {reorderEnabled ? <Unlock className="mr-2 h-3.5 w-3.5" /> : <Lock className="mr-2 h-3.5 w-3.5" />}
                                            {reorderEnabled ? 'Parar ordenação' : 'Ordenar'}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            disabled={!canAddSongsToRepertoire || availableSongs.length === 0}
                                            onSelect={handleOpenAddForm}
                                        >
                                            <Plus className="mr-2 h-3.5 w-3.5" />
                                            Adicionar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            disabled={repertoire.length === 0}
                                            onSelect={() => void handleExportWhatsapp()}
                                        >
                                            <Share className="mr-2 h-3.5 w-3.5" />
                                            Exportar p/ WhatsApp
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <div className="hidden items-center gap-2 sm:flex">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleOpenPlaylist()}
                                >
                                    <Play className="mr-1.5 h-3.5 w-3.5" />
                                    Playlist
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={repertoire.length === 0}
                                    onClick={() => void handleExportWhatsapp()}
                                >
                                    <Share className="mr-1.5 h-3.5 w-3.5" />
                                    Exportar p/ WhatsApp
                                </Button>
                                <Button
                                    type="button"
                                    variant={reorderEnabled ? 'default' : 'outline'}
                                    size="sm"
                                    disabled={!(isAdmin || isSinger)}
                                    title={!(isAdmin || isSinger) ? 'Apenas administradores e usuários com a função Voz podem ordenar o repertório.' : undefined}
                                    onClick={() => {
                                        if (!(isAdmin || isSinger)) return
                                        setReorderEnabled(prev => !prev)
                                        setDraggingIndex(null)
                                        setDragOverIndex(null)
                                        setReorderError(null)
                                    }}
                                >
                                    {reorderEnabled ? <Unlock className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
                                    {reorderEnabled ? 'Ordenação ativa' : 'Ordenar'}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleOpenAddForm}
                                    disabled={!canAddSongsToRepertoire || availableSongs.length === 0}
                                    title={!canAddSongsToRepertoire ? 'Apenas administradores e usuários com a função Voz podem adicionar músicas ao repertório.' : undefined}
                                >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                                    Adicionar
                                </Button>
                                </div>
                            </div>
                        </div>

                        {!canAddSongsToRepertoire && (
                            <Alert>
                                <AlertDescription>
                                    Modo visualização: músicos e backing vocals podem consultar o repertório, mas somente administradores e usuários com a função Voz podem adicionar músicas.
                                </AlertDescription>
                            </Alert>
                        )}

                        {reorderEnabled && (
                            <Alert>
                                <AlertDescription>
                                    Modo de ordenação ativo.
                                </AlertDescription>
                            </Alert>
                        )}

                        {reorderError && (
                            <Alert variant="destructive">
                                <AlertDescription>{reorderError}</AlertDescription>
                            </Alert>
                        )}

                        {/* ── List + Pagination ── */}
                        {loading ? (
                            <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
                        ) : repertoire.length === 0 ? (
                            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-14 text-center">
                                <div className="mb-3 rounded-2xl bg-muted p-4">
                                    <ListMusic className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <p className="mb-1 text-sm font-semibold text-foreground">Nenhuma música ainda</p>
                                <p className="mb-4 text-xs text-muted-foreground">
                                    Adicione músicas para este {selectedDay.serviceType === 'special' ? 'evento' : 'culto'}.
                                </p>
                                <Button
                                    size="sm"
                                    onClick={handleOpenAddForm}
                                    disabled={!canAddSongsToRepertoire || availableSongs.length === 0}
                                    title={!canAddSongsToRepertoire ? 'Apenas administradores e usuários com a função Voz podem adicionar músicas ao repertório.' : undefined}
                                >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                                    Adicionar música
                                </Button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    {repertoire.map((item, index) => (
                                        <div
                                            key={item.id}
                                            data-reorder-index={index}
                                            draggable={reorderEnabled}
                                            onDragStart={() => handleDragStart(index)}
                                            onDragOver={e => handleDragOver(e, index)}
                                            onDrop={() => void handleDrop(index)}
                                            onDragEnd={handleDragEnd}
                                            className={[
                                                'flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 transition-shadow hover:shadow-sm',
                                                reorderEnabled ? 'select-none' : '',
                                                draggingIndex === index ? 'opacity-60' : '',
                                                dragOverIndex === index && draggingIndex !== index ? 'border-primary bg-primary/5' : '',
                                            ].join(' ')}
                                        >
                                            {reorderEnabled && (
                                                <div className="flex flex-col items-center mr-2 space-y-0.5 sm:space-y-1">
                                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 p-1"
                                                        onClick={() => void moveRepertoireItem(index, index - 1)} disabled={index === 0}>
                                                        <ArrowUp className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 p-1"
                                                        onClick={() => void moveRepertoireItem(index, index + 1)} disabled={index === repertoire.length - 1}>
                                                        <ArrowDown className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            )}
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                                                {((page - 1) * PAGE_SIZE) + index + 1}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-semibold text-foreground">{item.song?.title}</span>
                                                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{item.song?.tone}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                    {item.song?.artist}
                                                    {item.minister && <> · <span>{item.minister.name}</span></>}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center">
                                                {item.song && (item.song.cifra_pdf_path || (item.song.cifra_content && item.song.cifra_content.length > 0)) ? (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => {
                                                            const s = item.song
                                                            if (s && openPdfCifraInSystemBrowserFromUserGesture(s)) return
                                                            setSelectedCifraSong(s ?? null)
                                                        }}
                                                        title="Ver cifra no app"
                                                        aria-label="Ver cifra no app"
                                                    >
                                                        <FileText className="h-3.5 w-3.5" />
                                                    </Button>
                                                ) : item.song?.cipher_url ? (
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                                                        <a href={item.song.cipher_url} target="_blank" rel="noopener noreferrer" title="Abrir cifra"><FileText className="h-3.5 w-3.5" /></a>
                                                    </Button>
                                                ) : null}
                                                {item.song?.youtube_url && (
                                                    <Button variant="ghost" size="icon" className="h-9 w-9 touch-manipulation sm:h-7 sm:w-7" asChild>
                                                        <a href={item.song.youtube_url} target="_blank" rel="noopener noreferrer" title="Abrir no YouTube"><Youtube className="h-3.5 w-3.5" /></a>
                                                    </Button>
                                                )}
                                                {(isAdmin || isSinger) && (
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                        onClick={() => setDeletingItem(item)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* Pagination */}
                                {totalRepertoire > PAGE_SIZE && (
                                    <div className="mt-4">
                                        <Pagination>
                                            <PaginationContent>
                                                <PaginationItem>
                                                    <PaginationPrevious
                                                        href="#"
                                                        onClick={e => { e.preventDefault(); setPage(p => Math.max(1, p - 1)) }}
                                                        aria-disabled={page === 1}
                                                    />
                                                </PaginationItem>
                                                {Array.from({ length: Math.ceil(totalRepertoire / PAGE_SIZE) }).map((_, i) => (
                                                    <PaginationItem key={i}>
                                                        <PaginationLink
                                                            href="#"
                                                            isActive={page === i + 1}
                                                            onClick={e => { e.preventDefault(); setPage(i + 1) }}
                                                        >
                                                            {i + 1}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                ))}
                                                <PaginationItem>
                                                    <PaginationNext
                                                        href="#"
                                                        onClick={e => { e.preventDefault(); setPage(p => Math.min(Math.ceil(totalRepertoire / PAGE_SIZE), p + 1)) }}
                                                        aria-disabled={page === Math.ceil(totalRepertoire / PAGE_SIZE)}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </main>

            {/* ── Add repertoire dialog ── */}
            <Dialog open={formOpen} onOpenChange={setFormOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Adicionar ao Repertório</DialogTitle>
                        <DialogDescription>
                            {selectedDay?.eventName} · {selectedDay && format(selectedDay.date, "d 'de' MMMM", { locale: ptBR })}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddToRepertoire} className="space-y-4">
                        {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
                        {isAdmin && (
                            <div className="space-y-2">
                                <Label>
                                    <span className="inline-flex items-center gap-2">
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
                                        Selecione o ministro
                                    </span>
                                </Label>
                                <Select value={formData.minister_id} onValueChange={v => setFormData(f => ({ ...f, minister_id: v, song_id: '' }))}>
                                    <SelectTrigger className="w-full"><SelectValue placeholder="Selecione um ministro" /></SelectTrigger>
                                    <SelectContent>
                                        {ministers
                                            .filter((m) => hasLeadVoiceRole(m.instrument))
                                            .map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.instrument})</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>
                                <span className="inline-flex items-center gap-2">
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{isAdmin ? '2' : '1'}</span>
                                    Selecione a música
                                </span>
                            </Label>
                            <Select value={formData.song_id} onValueChange={v => setFormData(f => ({ ...f, song_id: v }))} disabled={isAdmin && !formData.minister_id}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={isAdmin && !formData.minister_id ? 'Selecione primeiro o ministro' : 'Selecione uma música'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredSongsForForm.length > 0 ? (
                                        filteredSongsForForm.map(s => <SelectItem key={s.id} value={s.id}>{s.title} — {s.artist} ({s.tone})</SelectItem>)
                                    ) : (
                                        <SelectItem value="__empty" disabled>
                                            {isAdmin && !formData.minister_id ? 'Selecione um ministro para listar músicas' : 'Nenhuma música encontrada'}
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {isAdmin
                                    ? (formData.minister_id
                                        ? `Mostrando ${filteredSongsForForm.length} música(s) disponíveis para o ministro selecionado.`
                                        : 'Primeiro selecione o ministro para listar as músicas dele.')
                                    : `Mostrando ${filteredSongsForForm.length} música(s) disponíveis.`}
                            </p>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={!canAddSongsToRepertoire || !formData.song_id || (isAdmin && !formData.minister_id)}>Adicionar</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Create event dialog ── */}
            <Dialog open={createEventOpen} onOpenChange={setCreateEventOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-amber-500" />
                            Novo Evento Especial
                        </DialogTitle>
                        <DialogDescription>Crie um evento e adicione músicas a ele.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={e => { if (isMedia) { e.preventDefault(); return; } handleCreateEvent(e); }} className="space-y-4">
                        {newEventError && <Alert variant="destructive"><AlertDescription>{newEventError}</AlertDescription></Alert>}
                        <div className="space-y-2">
                            <Label>Nome do evento</Label>
                            <Input placeholder="Ex.: Conferência Jovem, Retiro..." value={newEventName} onChange={e => setNewEventName(e.target.value)} autoFocus />
                        </div>
                        <div className="space-y-2">
                            <Label>Data</Label>
                            <Input type="date" value={newEventDate} onChange={e => setNewEventDate(e.target.value)} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setCreateEventOpen(false)}>Cancelar</Button>
                            <Button type="submit">Criar evento</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Delete song dialog ── */}
            <AlertDialog open={!!deletingItem} onOpenChange={open => !open && setDeletingItem(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remover do Repertório</AlertDialogTitle>
                        <AlertDialogDescription>Tem certeza que deseja remover "{deletingItem?.song?.title}" do repertório?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Rename event dialog ── */}
            <Dialog open={!!editingEvent} onOpenChange={open => !open && setEditingEvent(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4 text-amber-500" />
                            Renomear Evento Especial
                        </DialogTitle>
                        <DialogDescription>Altere o nome do evento especial.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleRenameEvent} className="space-y-4">
                        {editEventError && <Alert variant="destructive"><AlertDescription>{editEventError}</AlertDescription></Alert>}
                        <div className="space-y-2">
                            <Label>Nome do evento</Label>
                            <Input value={editEventName} onChange={e => setEditEventName(e.target.value)} autoFocus />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setEditingEvent(null)}>Cancelar</Button>
                            <Button type="submit">Salvar</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Delete event dialog ── */}
            <AlertDialog open={!!deletingEvent} onOpenChange={open => !open && setDeletingEvent(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Evento Especial</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja excluir "{deletingEvent?.name}"? Todo o repertório vinculado também será removido. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteEvent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Excluir evento e repertório
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <CifraViewer
                song={selectedCifraSong}
                open={Boolean(selectedCifraSong)}
                onOpenChange={(open) => {
                    if (!open) setSelectedCifraSong(null)
                }}
            />

        </div>
    )
}
