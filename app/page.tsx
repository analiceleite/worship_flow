'use client'

import { useEffect, useState, useCallback } from 'react'
import { Song, Minister } from '@/lib/types'
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

export default function HomePage() {
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingSong, setEditingSong] = useState<Song | null>(null)
  const [deletingSong, setDeletingSong] = useState<Song | null>(null)
  const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

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

  const fetchSongs = useCallback(async () => {
    if (!currentMinister) return
    
    const supabase = createClient()
    
    // Ministers see only their songs, admins see all songs with minister info
    let query = supabase
      .from('songs')
      .select(`
        *,
        minister:ministers(id, name, instrument)
      `)
      .order('title', { ascending: true })
    
    // Filter by minister_id if not admin
    if (!isAdmin) {
      query = query.eq('minister_id', currentMinister.id)
    }

    const { data, error } = await query

    if (error) {
      console.error('Erro ao buscar músicas:', error)
    } else {
      setSongs(data || [])
    }
    setLoading(false)
  }, [currentMinister, isAdmin])

  useEffect(() => {
    fetchSongs()
  }, [fetchSongs])

  const canEditSong = (song: Song) => {
    if (isAdmin) return true
    return song.minister_id === currentMinister?.id
  }

  const handleDeleteSong = async () => {
    if (!deletingSong) return

    const supabase = createClient()
    const { error } = await supabase
      .from('songs')
      .delete()
      .eq('id', deletingSong.id)

    if (error) throw error
    await fetchSongs()
  }

  const filteredSongs = songs.filter(
    (song) =>
      song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
      song.tone.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isAdmin ? 'Todas as Músicas' : 'Minhas Músicas'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {songs.length} {songs.length === 1 ? 'música' : 'músicas'} {isAdmin ? 'cadastradas' : 'no seu repertório'}
            </p>
          </div>

          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Música
          </Button>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, artista ou tom..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

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
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Música
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredSongs.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onEdit={(s) => {
                  setEditingSong(s)
                  setFormOpen(true)
                }}
                onDelete={(s) => setDeletingSong(s)}
                canEdit={canEditSong(song)}
                showMinister={isAdmin}
              />
            ))}
          </div>
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
