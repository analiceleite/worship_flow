'use client'

import { useEffect, useState, useCallback } from 'react'
import { Song, Minister } from '@/lib/types'
import { hasLeadVoiceRole } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { SongCard } from '@/components/song-card'
import { SongForm } from '@/components/song-form'
import { DeleteDialog } from '@/components/delete-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Search, Music } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination'

const PAGE_SIZE = 20

function getPaginationRange(current: number, total: number): (number | '...')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const delta = 2
    const range: (number | '...')[] = []
    const left = Math.max(2, current - delta)
    const right = Math.min(total - 1, current + delta)
    range.push(1)
    if (left > 2) range.push('...')
    for (let i = left; i <= right; i++) range.push(i)
    if (right < total - 1) range.push('...')
    range.push(total)
    return range
}

export default function HomePage() {
    const [songs, setSongs] = useState<Song[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editingSong, setEditingSong] = useState<Song | null>(null)
    const [deletingSong, setDeletingSong] = useState<Song | null>(null)
    const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
    const [isAdmin, setIsAdmin] = useState(false)
    const [ministers, setMinisters] = useState<Minister[]>([])
    const [selectedMinisterId, setSelectedMinisterId] = useState<string>('all')
    const [totalSongs, setTotalSongs] = useState(0)
    const [page, setPage] = useState(1)
    const [appliedSearch, setAppliedSearch] = useState('')

    const isSinger = hasLeadVoiceRole(currentMinister?.instrument)
    const canManageSongs = isAdmin || isSinger

    useEffect(() => {
        checkUserRole()
    }, [])

    // Debounce search input and reset page together so only one fetch fires
    useEffect(() => {
        const timer = setTimeout(() => {
            setAppliedSearch(searchQuery)
            setPage(1)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

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

    const fetchSongs = useCallback(async () => {
        if (!currentMinister) return
        setLoading(true)
        const supabase = createClient()

        let query = supabase
            .from('songs')
            .select('*, minister:ministers(id, name, instrument)', { count: 'exact' })
            .order('title', { ascending: true })
            .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

        if (appliedSearch.trim()) {
            query = query.or(
                `title.ilike.%${appliedSearch.trim()}%,artist.ilike.%${appliedSearch.trim()}%,tone.ilike.%${appliedSearch.trim()}%`
            )
        }

        if (selectedMinisterId !== 'all') {
            query = query.eq('minister_id', selectedMinisterId)
        }

        const { data, error, count } = await query

        if (error) {
            console.error('Erro ao buscar músicas:', error)
        } else {
            setSongs(data || [])
            setTotalSongs(count ?? 0)
        }
        setLoading(false)
    }, [currentMinister, page, appliedSearch, selectedMinisterId])

    useEffect(() => {
        const supabase = createClient()
        supabase
            .from('ministers')
            .select('*')
            .eq('is_active', true)
            .order('name')
            .then(({ data }: { data: Minister[] | null }) => { if (data) setMinisters(data) })
    }, [])

    useEffect(() => {
        fetchSongs()
    }, [fetchSongs])

    const canEditSong = (song: Song) => {
        if (!canManageSongs) return false
        if (isAdmin) return true
        return song.minister_id === currentMinister?.id
    }

    const handleDeleteSong = async () => {
        if (!deletingSong) return
        if (!canEditSong(deletingSong)) {
            setDeletingSong(null)
            return
        }

        const supabase = createClient()
        const { error } = await supabase
            .from('songs')
            .delete()
            .eq('id', deletingSong.id)

        if (error) throw error
        await fetchSongs()
    }

    // Build a map of normalized title → number of versions (used only in admin view).
    // Groups by title only (ignoring artist) so that small differences in artist name
    // between ministers don't prevent duplicates from being detected.
    const normalizeTitle = (t: string) => t.toLowerCase().trim().replace(/\s+/g, ' ')

    const versionCountMap = isAdmin
        ? songs.reduce<Record<string, number>>((acc, s) => {
            const key = normalizeTitle(s.title)
            acc[key] = (acc[key] ?? 0) + 1
            return acc
        }, {})
        : {}

    const getVersionCount = (song: Song) => versionCountMap[normalizeTitle(song.title)] ?? 1

    // Filtering and pagination handled server-side; songs already contains the current page.
    const filteredSongs = songs

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">
                            Repertório Geral de Músicas
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {totalSongs} {totalSongs === 1 ? 'música' : 'músicas'} {appliedSearch || selectedMinisterId !== 'all' ? 'encontradas' : 'cadastradas'}
                        </p>
                    </div>

                    <Button onClick={() => setFormOpen(true)} disabled={!canManageSongs} title={!canManageSongs ? 'Somente administradores e usuários com a função Voz podem cadastrar músicas.' : undefined}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Música
                    </Button>
                </div>

                {!canManageSongs && (
                    <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Você está em modo visualização: músicos e backing vocals podem ver toda a lista, mas apenas administradores e usuários com a função Voz podem criar, editar ou excluir músicas.
                    </div>
                )}

                <div className="mb-6 flex flex-col gap-3 sm:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por título ou artista..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <Select value={selectedMinisterId} onValueChange={(v) => { setSelectedMinisterId(v); setPage(1) }}>
                        <SelectTrigger className="w-full sm:w-56">
                            <SelectValue placeholder="Filtrar por ministro" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os ministros</SelectItem>
                            {ministers.filter((m) => hasLeadVoiceRole(m.instrument)).map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                    {m.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {selectedMinisterId !== 'all' && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                        <span>
                            {totalSongs} música(s) cadastrada(s) para o ministro selecionado.
                        </span>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-8 w-8" />
                    </div>
                ) : filteredSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-4 rounded-full bg-muted p-4">
                            <Music className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="mb-1 text-lg font-medium text-foreground">
                            {searchQuery ? 'Nenhuma música encontrada' : 'Nenhuma música cadastrada'}
                        </h3>
                        <p className="mb-4 text-sm text-muted-foreground">
                            {searchQuery
                                ? 'Tente buscar por outro termo.'
                                : 'Comece adicionando sua primeira música.'}
                        </p>
                        {!searchQuery && (
                            <Button onClick={() => setFormOpen(true)} disabled={!canManageSongs} title={!canManageSongs ? 'Somente administradores e usuários com a função Voz podem cadastrar músicas.' : undefined}>
                                <Plus className="mr-2 h-4 w-4" />
                                Adicionar Música
                            </Button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filteredSongs.map((song) => (
                                <SongCard
                                    key={song.id}
                                    song={song}
                                    onEdit={canEditSong(song) ? (s) => {
                                        setEditingSong(s)
                                        setFormOpen(true)
                                    } : undefined}
                                    onDelete={canEditSong(song) ? (s) => setDeletingSong(s) : undefined}
                                    canEdit={canEditSong(song)}
                                    showMinister
                                    duplicateCount={getVersionCount(song)}
                                />
                            ))}
                        </div>
                        {totalSongs > PAGE_SIZE && (
                            <div className="mt-6">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <PaginationPrevious
                                                href="#"
                                                onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)) }}
                                                aria-disabled={page === 1}
                                                className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                                            />
                                        </PaginationItem>
                                        {getPaginationRange(page, Math.ceil(totalSongs / PAGE_SIZE)).map((p, i) =>
                                            p === '...' ? (
                                                <PaginationItem key={`ellipsis-${i}`}>
                                                    <PaginationEllipsis />
                                                </PaginationItem>
                                            ) : (
                                                <PaginationItem key={p}>
                                                    <PaginationLink
                                                        href="#"
                                                        isActive={page === p}
                                                        onClick={(e) => { e.preventDefault(); setPage(p as number) }}
                                                    >
                                                        {p}
                                                    </PaginationLink>
                                                </PaginationItem>
                                            )
                                        )}
                                        <PaginationItem>
                                            <PaginationNext
                                                href="#"
                                                onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(Math.ceil(totalSongs / PAGE_SIZE), p + 1)) }}
                                                aria-disabled={page === Math.ceil(totalSongs / PAGE_SIZE)}
                                                className={page === Math.ceil(totalSongs / PAGE_SIZE) ? 'pointer-events-none opacity-50' : ''}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </>
                )}
            </main>

            <SongForm
                open={formOpen}
                onOpenChange={(open) => {
                    setFormOpen(open)
                    if (!open) setEditingSong(null)
                }}
                song={editingSong}
                onSuccess={fetchSongs}
                currentMinister={currentMinister}
            />

            <DeleteDialog
                open={!!deletingSong}
                onOpenChange={(open) => !open && setDeletingSong(null)}
                title="Excluir Música"
                description={`Tem certeza que deseja excluir "${deletingSong?.title}"? Esta ação não pode ser desfeita.`}
                onConfirm={handleDeleteSong}
            />
        </div>
    )
}
