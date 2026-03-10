'use client'

import { Song } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Music, Youtube, FileText, Pencil, Trash2, Copy } from 'lucide-react'

interface SongCardProps {
  song: Song
  onEdit?: (song: Song) => void
  onDelete?: (song: Song) => void
  canEdit?: boolean
  showMinister?: boolean
  duplicateCount?: number
}

export function SongCard({ song, onEdit, onDelete, canEdit = true, showMinister = false, duplicateCount = 1 }: SongCardProps) {
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
                title="Abrir no YouTube"
                aria-label="Abrir no YouTube"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform hover:scale-110"
              >
                <Youtube className="h-7 w-7" />
              </a>
            </div>

            {canEdit && (onEdit || onDelete) && (
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-background/80 p-1 backdrop-blur">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEdit(song)}
                    title="Editar música"
                    aria-label="Editar música"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDelete(song)}
                    title="Excluir música"
                    aria-label="Excluir música"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        
        {!song.youtube_url && (
          <div className="relative flex aspect-video items-center justify-center bg-muted">
            <Music className="h-12 w-12 text-muted-foreground" />

            {canEdit && (onEdit || onDelete) && (
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-background/80 p-1 backdrop-blur">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEdit(song)}
                    title="Editar música"
                    aria-label="Editar música"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDelete(song)}
                    title="Excluir música"
                    aria-label="Excluir música"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
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

          {(showMinister || duplicateCount > 1) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {showMinister && song.minister && (
                <Badge variant="outline" className="text-xs">
                  {song.minister.name} • {song.minister.instrument}
                </Badge>
              )}
              {duplicateCount > 1 && (
                <Badge
                  variant="secondary"
                  className="gap-1 bg-amber-100 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                  title={`Esta música tem ${duplicateCount} versões cadastradas por ministros diferentes`}
                >
                  <Copy className="h-3 w-3" />
                  {duplicateCount} versões
                </Badge>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {song.cipher_url ? (
              <Button variant="secondary" size="sm" className="flex-1" asChild>
                <a
                  href={song.cipher_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir cifra"
                  aria-label="Abrir cifra"
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  Cifra
                </a>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="flex-1" disabled title="Sem link de cifra">
                <FileText className="mr-1.5 h-4 w-4" />
                Cifra
              </Button>
            )}

            {song.youtube_url ? (
              <Button variant="secondary" size="sm" className="flex-1" asChild>
                <a
                  href={song.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir no YouTube"
                  aria-label="Abrir no YouTube"
                >
                  <Youtube className="mr-1.5 h-4 w-4" />
                  YouTube
                </a>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="flex-1" disabled title="Sem link de YouTube">
                <Youtube className="mr-1.5 h-4 w-4" />
                YouTube
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
