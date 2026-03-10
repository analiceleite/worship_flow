'use client'

import { Song } from '@/lib/types'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft, Youtube, FileText, Music } from 'lucide-react'
import Link from 'next/link'

interface SongDetailClientProps {
  song: Song
}

export function SongDetailClient({ song }: SongDetailClientProps) {
  const getYoutubeId = (url: string) => {
    const match = url.match(
      /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([\w-]{11})/
    )
    return match ? match[1] : null
  }

  const youtubeId = song.youtube_url ? getYoutubeId(song.youtube_url) : null

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        <div className="mb-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary">
              <Music className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                {song.title}
              </h1>
              <p className="text-lg text-muted-foreground">{song.artist}</p>
              <Badge variant="secondary" className="mt-2 font-mono">
                Tom: {song.tone}
              </Badge>
            </div>
          </div>
        </div>

        {youtubeId && (
          <Card className="mb-6 overflow-hidden">
            <CardContent className="p-0">
              <div className="relative aspect-video">
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  title={song.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          {song.cipher_url && (
            <Button className="flex-1" asChild>
              <a href={song.cipher_url} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-2 h-5 w-5" />
                Ver Cifra
              </a>
            </Button>
          )}

          {song.youtube_url && (
            <Button variant="outline" className="flex-1" asChild>
              <a href={song.youtube_url} target="_blank" rel="noopener noreferrer">
                <Youtube className="mr-2 h-5 w-5" />
                Abrir no YouTube
              </a>
            </Button>
          )}
        </div>

        {!song.cipher_url && !song.youtube_url && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-muted p-4">
                <Music className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-1 text-lg font-medium text-foreground">
                Sem recursos adicionais
              </h3>
              <p className="text-sm text-muted-foreground">
                Esta música ainda não possui cifra ou vídeo cadastrados.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
