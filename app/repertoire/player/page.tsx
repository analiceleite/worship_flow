'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, SkipBack, SkipForward, Youtube } from 'lucide-react'
import { Header } from '@/components/header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { RepertoireItem } from '@/lib/types'

declare global {
    interface Window {
        YT?: {
            Player: new (elementId: string, options: {
                videoId: string
                playerVars?: Record<string, number>
                events?: {
                    onReady?: () => void
                    onStateChange?: (event: { data: number }) => void
                }
            }) => {
                destroy: () => void
                loadVideoById: (videoId: string) => void
            }
            PlayerState: { ENDED: number }
        }
        onYouTubeIframeAPIReady?: () => void
    }
}

function extractYouTubeVideoId(url: string | null | undefined): string | null {
    if (!url) return null
    const value = url.trim()
    if (!value) return null

    if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
        return value
    }

    try {
        const parsed = new URL(value)

        if (parsed.hostname.includes('youtube.com')) {
            const watch = parsed.searchParams.get('v')
            if (watch && /^[a-zA-Z0-9_-]{11}$/.test(watch)) {
                return watch
            }

            const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/)
            if (shortsMatch?.[1]) return shortsMatch[1]

            const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/)
            if (embedMatch?.[1]) return embedMatch[1]
        }

        if (parsed.hostname === 'youtu.be') {
            const shortId = parsed.pathname.replace('/', '')
            if (/^[a-zA-Z0-9_-]{11}$/.test(shortId)) {
                return shortId
            }
        }
    } catch {
        return null
    }

    return null
}

function YouTubePlayer({
    videoId,
    onEnded,
}: {
    videoId: string
    onEnded: () => void
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const playerRef = useRef<{ destroy: () => void; loadVideoById: (videoId: string) => void } | null>(null)
    const [apiReady, setApiReady] = useState(false)

    useEffect(() => {
        const existingScript = document.getElementById('youtube-iframe-api') as HTMLScriptElement | null

        if (window.YT?.Player) {
            setApiReady(true)
            return
        }

        const onReady = () => setApiReady(true)
        const previousHandler = window.onYouTubeIframeAPIReady
        window.onYouTubeIframeAPIReady = () => {
            previousHandler?.()
            onReady()
        }

        if (!existingScript) {
            const script = document.createElement('script')
            script.id = 'youtube-iframe-api'
            script.src = 'https://www.youtube.com/iframe_api'
            document.body.appendChild(script)
        }

        return () => {
            window.onYouTubeIframeAPIReady = previousHandler
        }
    }, [])

    useEffect(() => {
        if (!apiReady || !containerRef.current || !window.YT?.Player) return

        if (!playerRef.current) {
            const playerId = `yt-player-${Math.random().toString(36).slice(2, 9)}`
            containerRef.current.id = playerId

            playerRef.current = new window.YT.Player(playerId, {
                videoId,
                playerVars: {
                    autoplay: 1,
                    modestbranding: 1,
                    rel: 0,
                },
                events: {
                    onStateChange: (event) => {
                        if (window.YT && event.data === window.YT.PlayerState.ENDED) {
                            onEnded()
                        }
                    },
                },
            })
            return
        }

        playerRef.current.loadVideoById(videoId)
    }, [apiReady, videoId, onEnded])

    useEffect(() => {
        return () => {
            playerRef.current?.destroy()
            playerRef.current = null
        }
    }, [])

    return <div ref={containerRef} className="h-full w-full" />
}

export default function RepertoirePlayerPage() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const date = searchParams.get('date')
    const eventName = searchParams.get('eventName')

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [items, setItems] = useState<RepertoireItem[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)

    useEffect(() => {
        const fetchItems = async () => {
            if (!date || !eventName) {
                setError('Informações do repertório inválidas.')
                setLoading(false)
                return
            }

            setLoading(true)
            setError(null)

            const supabase = createClient()
            const { data, error: repError } = await supabase
                .from('repertoire')
                .select('*, song:songs(*), minister:ministers(*)')
                .eq('event_date', date)
                .eq('event_name', eventName)
                .order('order_index')

            if (repError) {
                setError(repError.message || 'Não foi possível carregar a playlist.')
                setLoading(false)
                return
            }

            const loaded: RepertoireItem[] = (data ?? []) as RepertoireItem[]
            setItems(loaded)

            const firstPlayable = loaded.findIndex((item) => extractYouTubeVideoId(item.song?.youtube_url))
            setCurrentIndex(firstPlayable >= 0 ? firstPlayable : 0)
            setLoading(false)
        }

        void fetchItems()
    }, [date, eventName])

    const currentItem = items[currentIndex]
    const currentVideoId = useMemo(
        () => extractYouTubeVideoId(currentItem?.song?.youtube_url),
        [currentItem]
    )

    const canGoPrev = currentIndex > 0
    const canGoNext = currentIndex < items.length - 1

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back()
            return
        }
        router.push('/repertoire')
    }

    const formattedDate = useMemo(() => {
        if (!date) return ''
        const parsed = new Date(`${date}T12:00:00`)
        if (Number.isNaN(parsed.getTime())) return date
        return format(parsed, "dd 'de' MMMM", { locale: ptBR })
    }, [date])

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container mx-auto p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={handleBack}>
                        <ChevronLeft className="mr-1.5 h-4 w-4" />
                        Retornar
                    </Button>
                </div>

                <div className="mb-4 rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Evento</p>
                    <p className="text-sm font-semibold">{eventName || 'Sem nome'}</p>
                    {formattedDate && <p className="text-xs text-muted-foreground">{formattedDate}</p>}
                </div>

                {error && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {loading ? (
                    <div className="rounded-xl border bg-muted/10 p-6 text-sm text-muted-foreground">
                        Carregando playlist...
                    </div>
                ) : items.length === 0 ? (
                    <div className="rounded-xl border bg-muted/10 p-6 text-sm text-muted-foreground">
                        Nenhuma música encontrada para esse repertório.
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr]">
                        <section className="rounded-xl border bg-muted/20 p-3 sm:p-4">
                            <div className="mb-3 rounded-lg border bg-background px-3 py-2">
                                <p className="text-xs uppercase tracking-wider text-muted-foreground">Tocando agora</p>
                                <p className="truncate text-sm font-semibold text-foreground">{currentItem?.song?.title}</p>
                                <p className="truncate text-xs text-muted-foreground">{currentItem?.song?.artist}</p>
                            </div>

                            <div className="aspect-video overflow-hidden rounded-xl border bg-black">
                                {currentVideoId ? (
                                    <YouTubePlayer
                                        videoId={currentVideoId}
                                        onEnded={() => {
                                            setCurrentIndex((idx) => (idx + 1) % items.length)
                                        }}
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                                        Essa música não possui link válido do YouTube.
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!canGoPrev}
                                    onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                                >
                                    <SkipBack className="mr-1.5 h-3.5 w-3.5" />
                                    Anterior
                                </Button>

                                <span className="text-xs text-muted-foreground">
                                    {currentIndex + 1} de {items.length}
                                </span>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={!canGoNext}
                                    onClick={() => setCurrentIndex((idx) => Math.min(items.length - 1, idx + 1))}
                                >
                                    Próxima
                                    <SkipForward className="ml-1.5 h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </section>

                        <section className="rounded-xl border bg-muted/20 p-3 sm:p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fila</p>
                            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                                {items.map((item, idx) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setCurrentIndex(idx)}
                                        className={[
                                            'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                                            idx === currentIndex
                                                ? 'border-primary bg-primary/10'
                                                : 'border-border hover:bg-muted/40',
                                        ].join(' ')}
                                    >
                                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                                            {idx + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-foreground">{item.song?.title}</p>
                                            <p className="truncate text-xs text-muted-foreground">{item.song?.artist}</p>
                                        </div>
                                        {!extractYouTubeVideoId(item.song?.youtube_url) ? (
                                            <Youtube className="h-4 w-4 text-muted-foreground" />
                                        ) : null}
                                        {idx === currentIndex && (
                                            <span className="text-xs font-medium text-primary">agora</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                )}
            </main>
        </div>
    )
}
