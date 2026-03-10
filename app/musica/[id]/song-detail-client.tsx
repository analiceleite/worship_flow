'use client'

import { Song } from '@/lib/types'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
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

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">

        {/* ── Back ── */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        {/* ── Song header ── */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Music className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-foreground">
              {song.title}
            </h1>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{song.artist}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {song.tone}
              </span>
            </div>
          </div>
        </div>

        {/* ── YouTube embed ── */}
        {youtubeId && (
          <div className="mb-5 overflow-hidden rounded-xl border border-border">
            <div className="relative aspect-video">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title={song.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          </div>
        )}

        {/* ── Action buttons ── */}
        {(song.cipher_url || song.youtube_url) ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {song.cipher_url && (
              <Button className="flex-1" asChild>
                <a href={song.cipher_url} target="_blank" rel="noopener noreferrer">
                  <FileText className="mr-2 h-4 w-4" />
                  Ver Cifra
                </a>
              </Button>
            )}
            {song.youtube_url && (
              <Button variant="outline" className="flex-1" asChild>
                <a href={song.youtube_url} target="_blank" rel="noopener noreferrer">
                  <Youtube className="mr-2 h-4 w-4" />
                  Abrir no YouTube
                </a>
              </Button>
            )}
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 rounded-2xl bg-muted p-5">
              <Music className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-foreground">
              Sem recursos adicionais
            </h3>
            <p className="text-sm text-muted-foreground">
              Esta música ainda não possui cifra ou vídeo cadastrados.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}