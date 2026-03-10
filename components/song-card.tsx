'use client'

import { Song } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Music, Youtube, FileText, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface SongCardProps {
  song: Song
  onEdit?: (song: Song) => void
  onDelete?: (song: Song) => void
  canEdit?: boolean
  showMinister?: boolean
}

export function SongCard({ song, onEdit, onDelete, canEdit = true, showMinister = false }: SongCardProps) {
  const getYoutubeId = (url: string) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([\w-]{11})/)
    return match ? match[1] : null
  }

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-md">
      <CardContent className="p-0">
        {song.youtube_url && (
          <div className="relative aspect-video bg-muted">
            <img
              src={`https://img.youtube.com/vi/${getYoutubeId(song.youtube_url)}/mqdefault.jpg`}
              alt={song.title}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-foreground/20 opacity-0 transition-opacity group-hover:opacity-100">
              <a
                href={song.youtube_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform hover:scale-110"
              >
                <Youtube className="h-7 w-7" />
              </a>
            </div>
          </div>
        )}
        
        {!song.youtube_url && (
          <div className="flex aspect-video items-center justify-center bg-muted">
            <Music className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        <div className="p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold text-foreground">
                {song.title}
              </h3>
              <p className="truncate text-sm text-muted-foreground">
                {song.artist}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 font-mono text-xs">
              {song.tone}
            </Badge>
          </div>

          {showMinister && song.minister && (
            <div className="mb-2">
              <Badge variant="outline" className="text-xs">
                {song.minister.name} • {song.minister.instrument}
              </Badge>
            </div>
          )}

          <div className="flex items-center gap-2">
            {song.cipher_url && (
              <Button variant="outline" size="sm" className="flex-1" asChild>
                <a href={song.cipher_url} target="_blank" rel="noopener noreferrer">
                  <FileText className="mr-1.5 h-4 w-4" />
                  Cifra
                </a>
              </Button>
            )}
            
            <Link href={`/musica/${song.id}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                <Music className="mr-1.5 h-4 w-4" />
                Ver
              </Button>
            </Link>
          </div>

          {canEdit && (onEdit || onDelete) && (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => onEdit(song)}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Editar
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(song)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Excluir
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
