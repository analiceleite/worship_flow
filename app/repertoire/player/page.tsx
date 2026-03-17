'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ExternalLink, FileText, SkipBack, SkipForward, Youtube } from 'lucide-react'
import { CifraPanel, CifraViewer } from '@/components/cifra-viewer'
import { Header } from '@/components/header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { Minister, RepertoireItem } from '@/lib/types'

type TimeSignature = '2/4' | '3/4' | '4/4' | '6/8'

const TIME_SIGNATURES: Array<{ value: TimeSignature; label: string; beatsPerBar: number }> = [
    { value: '2/4', label: '2/4', beatsPerBar: 2 },
    { value: '3/4', label: '3/4', beatsPerBar: 3 },
    { value: '4/4', label: '4/4', beatsPerBar: 4 },
    { value: '6/8', label: '6/8', beatsPerBar: 6 },
]

function getMinisterInstruments(instrument: string | null | undefined) {
    return (instrument ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
}

function canUseMetronome(minister: Minister | null) {
    if (!minister) return false
    if (minister.role === 'midia') return false

    const instruments = getMinisterInstruments(minister.instrument)
    if (instruments.length === 0) return false

    return instruments.some((instrument) => instrument !== 'voz' && instrument !== 'backing vocal')
}

declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext
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
    const playerRef = useRef<{ destroy: () => void } | null>(null)
    const playerIdRef = useRef(`yt-player-${Math.random().toString(36).slice(2, 9)}`)
    const onEndedRef = useRef(onEnded)
    const [apiReady, setApiReady] = useState(false)

    useEffect(() => {
        onEndedRef.current = onEnded
    }, [onEnded])

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

        containerRef.current.id = playerIdRef.current
        playerRef.current?.destroy()

        playerRef.current = new window.YT.Player(playerIdRef.current, {
            videoId,
            playerVars: {
                autoplay: 1,
                modestbranding: 1,
                rel: 0,
            },
            events: {
                onStateChange: (event) => {
                    if (window.YT && event.data === window.YT.PlayerState.ENDED) {
                        onEndedRef.current()
                    }
                },
            },
        })

        return () => {
            playerRef.current?.destroy()
            playerRef.current = null
        }
    }, [apiReady, videoId])

    useEffect(() => {
        return () => {
            playerRef.current?.destroy()
            playerRef.current = null
        }
    }, [])

    return <div ref={containerRef} className="h-full w-full" />
}

function RepertoirePlayerContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const audioContextRef = useRef<AudioContext | null>(null)
    const metronomeIntervalRef = useRef<number | null>(null)
    const metronomeBeatRef = useRef(0)
    const metronomeFlashTimeoutRef = useRef<number | null>(null)

    const date = searchParams.get('date')
    const eventName = searchParams.get('eventName')

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
    const [items, setItems] = useState<RepertoireItem[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [metronomeEnabled, setMetronomeEnabled] = useState(false)
    const [bpm, setBpm] = useState(72)
    const [bpmInput, setBpmInput] = useState('72')
    const [metronomeVolume, setMetronomeVolume] = useState(150)
    const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4')
    const [metronomeOpen, setMetronomeOpen] = useState(false)
    const [cifraViewerOpen, setCifraViewerOpen] = useState(false)
    const [beatFlash, setBeatFlash] = useState<{ active: boolean; accented: boolean; beat: number }>({
        active: false,
        accented: true,
        beat: 1,
    })
    const beatsPerBar = TIME_SIGNATURES.find((signature) => signature.value === timeSignature)?.beatsPerBar ?? 4
    const showMetronome = canUseMetronome(currentMinister)

    const clampBpm = useCallback((value: number) => Math.min(240, Math.max(40, value)), [])

    const commitBpmInput = useCallback(() => {
        const parsed = Number(bpmInput)
        if (Number.isNaN(parsed)) {
            setBpmInput(String(bpm))
            return
        }

        const nextBpm = clampBpm(parsed)
        setBpm(nextBpm)
        setBpmInput(String(nextBpm))
    }, [bpm, bpmInput, clampBpm])

    const flashBeat = useCallback((accented: boolean, beat: number) => {
        setBeatFlash({ active: true, accented, beat })

        if (metronomeFlashTimeoutRef.current !== null) {
            window.clearTimeout(metronomeFlashTimeoutRef.current)
        }

        metronomeFlashTimeoutRef.current = window.setTimeout(() => {
            setBeatFlash((previous) => ({ ...previous, active: false }))
            metronomeFlashTimeoutRef.current = null
        }, 120)
    }, [])

    const stopMetronome = useCallback(() => {
        if (metronomeFlashTimeoutRef.current !== null) {
            window.clearTimeout(metronomeFlashTimeoutRef.current)
            metronomeFlashTimeoutRef.current = null
        }

        setBeatFlash((previous) => ({ ...previous, active: false }))

        if (metronomeIntervalRef.current !== null) {
            window.clearInterval(metronomeIntervalRef.current)
            metronomeIntervalRef.current = null
        }

        metronomeBeatRef.current = 0
    }, [])

    const playMetronomeClick = useCallback((accented: boolean, beat: number) => {
        flashBeat(accented, beat)

        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        if (!AudioContextClass) return

        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContextClass()
        }

        const context = audioContextRef.current
        const oscillator = context.createOscillator()
        const gainNode = context.createGain()
        const now = context.currentTime
        const volumeFactor = metronomeVolume / 100
        const peakGain = (accented ? 0.18 : 0.12) * volumeFactor

        oscillator.type = 'square'
        oscillator.frequency.setValueAtTime(accented ? 1760 : 1320, now)

        if (peakGain > 0.0001) {
            gainNode.gain.setValueAtTime(0.0001, now)
            gainNode.gain.exponentialRampToValueAtTime(peakGain, now + 0.005)
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.07)
        } else {
            gainNode.gain.setValueAtTime(0, now)
        }

        oscillator.connect(gainNode)
        gainNode.connect(context.destination)

        oscillator.start(now)
        oscillator.stop(now + 0.08)
    }, [flashBeat, metronomeVolume])

    useEffect(() => {
        const fetchCurrentMinister = async () => {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: minister } = await supabase
                .from('ministers')
                .select('*')
                .eq('user_id', user.id)
                .single()

            setCurrentMinister((minister ?? null) as Minister | null)
        }

        void fetchCurrentMinister()
    }, [])

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

    const handlePlaylistEnded = useCallback(() => {
        setCurrentIndex((idx) => (idx + 1) % items.length)
    }, [items.length])

    useEffect(() => {
        const savedBpm = window.localStorage.getItem('repertoire-player-bpm')
        if (!savedBpm) return

        const parsed = Number(savedBpm)
        if (Number.isNaN(parsed)) return
        setBpm(clampBpm(parsed))
    }, [clampBpm])

    useEffect(() => {
        const savedTimeSignature = window.localStorage.getItem('repertoire-player-time-signature') as TimeSignature | null
        if (!savedTimeSignature) return

        if (TIME_SIGNATURES.some((signature) => signature.value === savedTimeSignature)) {
            setTimeSignature(savedTimeSignature)
        }
    }, [])

    useEffect(() => {
        window.localStorage.setItem('repertoire-player-bpm', String(bpm))
    }, [bpm])

    useEffect(() => {
        const savedVolume = window.localStorage.getItem('repertoire-player-metronome-volume')
        if (!savedVolume) return

        const parsed = Number(savedVolume)
        if (Number.isNaN(parsed)) return
        setMetronomeVolume(Math.min(500, Math.max(0, parsed)))
    }, [])

    useEffect(() => {
        setBpmInput(String(bpm))
    }, [bpm])

    useEffect(() => {
        window.localStorage.setItem('repertoire-player-time-signature', timeSignature)
    }, [timeSignature])

    useEffect(() => {
        window.localStorage.setItem('repertoire-player-metronome-volume', String(metronomeVolume))
    }, [metronomeVolume])

    useEffect(() => {
        if (!metronomeEnabled) {
            stopMetronome()
            return
        }

        const intervalMs = Math.max(40, Math.round(60000 / bpm))
        void audioContextRef.current?.resume?.()
        metronomeBeatRef.current = 1
        playMetronomeClick(true, 1)

        metronomeIntervalRef.current = window.setInterval(() => {
            metronomeBeatRef.current += 1
            const beat = ((metronomeBeatRef.current - 1) % beatsPerBar) + 1
            const accented = beat === 1
            playMetronomeClick(accented, beat)
        }, intervalMs)

        return stopMetronome
    }, [beatsPerBar, bpm, metronomeEnabled, playMetronomeClick, stopMetronome])

    useEffect(() => {
        return () => {
            stopMetronome()
            if (metronomeFlashTimeoutRef.current !== null) {
                window.clearTimeout(metronomeFlashTimeoutRef.current)
            }
            audioContextRef.current?.close()
            audioContextRef.current = null
        }
    }, [stopMetronome])

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
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Tocando agora</p>
                                        <p className="truncate text-sm font-semibold text-foreground">{currentItem?.song?.title}</p>
                                        <p className="truncate text-xs text-muted-foreground">{currentItem?.song?.artist}</p>
                                    </div>
                                    {currentItem?.song?.tone ? (
                                        <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                                            {currentItem.song.tone}
                                        </Badge>
                                    ) : null}
                                </div>

                                {currentItem?.song?.cifra_content && currentItem.song.cifra_content.length > 0 ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button type="button" variant="outline" size="sm" onClick={() => setCifraViewerOpen(true)}>
                                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                                            Abrir cifra
                                        </Button>
                                        {currentItem.song.cipher_url ? (
                                            <Button type="button" variant="ghost" size="sm" asChild>
                                                <a href={currentItem.song.cipher_url} target="_blank" rel="noopener noreferrer">
                                                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                                    CifraClub
                                                </a>
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : currentItem?.song?.cipher_url ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button type="button" variant="outline" size="sm" asChild>
                                            <a href={currentItem.song.cipher_url} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                                Abrir cifra externa
                                            </a>
                                        </Button>
                                    </div>
                                ) : null}
                            </div>

                            {showMetronome ? (
                                <Collapsible open={metronomeOpen} onOpenChange={setMetronomeOpen}>
                                    <div className="mb-3 rounded-lg border bg-background">
                                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-wider text-muted-foreground">Metrônomo</p>
                                                <p className="text-sm font-medium text-foreground">BPM {bpm} · {timeSignature}</p>
                                            </div>

                                            <CollapsibleTrigger asChild>
                                                <Button type="button" variant="outline" size="sm">
                                                    {metronomeOpen ? 'Ocultar' : 'Abrir'}
                                                </Button>
                                            </CollapsibleTrigger>
                                        </div>

                                        <CollapsibleContent>
                                            <div className="border-t px-3 py-3">
                                                <div className="flex flex-col gap-3">
                                                    <div className="flex flex-wrap gap-2">
                                                        {TIME_SIGNATURES.map((signature) => (
                                                            <Button
                                                                key={signature.value}
                                                                type="button"
                                                                variant={timeSignature === signature.value ? 'default' : 'outline'}
                                                                size="sm"
                                                                onClick={() => setTimeSignature(signature.value)}
                                                            >
                                                                {signature.label}
                                                            </Button>
                                                        ))}
                                                    </div>

                                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                type="button"
                                                                variant={metronomeEnabled ? 'default' : 'secondary'}
                                                                size="sm"
                                                                onClick={() => setMetronomeEnabled((value) => !value)}
                                                            >
                                                                {metronomeEnabled ? 'Parar' : 'Iniciar'}
                                                            </Button>
                                                        </div>

                                                        <div className="flex flex-col gap-3 sm:items-end">
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        const nextBpm = clampBpm(bpm - 1)
                                                                        setBpm(nextBpm)
                                                                        setBpmInput(String(nextBpm))
                                                                    }}
                                                                >
                                                                    -
                                                                </Button>
                                                                <Input
                                                                    type="number"
                                                                    min={40}
                                                                    max={240}
                                                                    value={bpmInput}
                                                                    onChange={(event) => setBpmInput(event.target.value)}
                                                                    onBlur={commitBpmInput}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Enter') {
                                                                            commitBpmInput()
                                                                        }
                                                                    }}
                                                                    className="w-24 text-center"
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        const nextBpm = clampBpm(bpm + 1)
                                                                        setBpm(nextBpm)
                                                                        setBpmInput(String(nextBpm))
                                                                    }}
                                                                >
                                                                    +
                                                                </Button>
                                                                <span className="text-xs text-muted-foreground">BPM</span>
                                                            </div>

                                                            <div className="flex w-full items-center gap-2 sm:w-64">
                                                                <span className="text-xs text-muted-foreground">Vol.</span>
                                                                <Input
                                                                    type="range"
                                                                    min={0}
                                                                    max={500}
                                                                    step={1}
                                                                    value={metronomeVolume}
                                                                    onChange={(event) => {
                                                                        const nextValue = Number(event.target.value)
                                                                        if (Number.isNaN(nextValue)) return
                                                                        setMetronomeVolume(Math.min(500, Math.max(0, nextValue)))
                                                                    }}
                                                                    className="h-2 w-full cursor-pointer accent-emerald-500"
                                                                />
                                                                <span className="w-10 text-right text-xs text-muted-foreground">{metronomeVolume}%</span>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                {Array.from({ length: beatsPerBar }, (_, index) => index + 1).map((beat) => {
                                                                    const active = beatFlash.active && beatFlash.beat === beat
                                                                    const accented = beat === 1

                                                                    return (
                                                                        <span
                                                                            key={beat}
                                                                            className={[
                                                                                'flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-all',
                                                                                accented
                                                                                    ? 'border-primary/50 text-primary'
                                                                                    : 'border-border text-muted-foreground',
                                                                                active && accented ? 'scale-110 bg-primary text-primary-foreground shadow-md' : '',
                                                                                active && !accented ? 'scale-105 bg-foreground text-background shadow-sm' : '',
                                                                            ].join(' ')}
                                                                        >
                                                                            {beat}
                                                                        </span>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </CollapsibleContent>
                                    </div>
                                </Collapsible>
                            ) : null}

                            <div className="aspect-video overflow-hidden rounded-xl border bg-black">
                                {currentVideoId ? (
                                    <YouTubePlayer
                                        videoId={currentVideoId}
                                        onEnded={handlePlaylistEnded}
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

                        <div className="space-y-4">
                            <section className="rounded-xl border bg-muted/20 p-3 sm:p-4">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Referência da cifra</p>
                                        <p className="text-xs text-muted-foreground">Acompanhe a música real com a cifra local e use o metrônomo se quiser.</p>
                                    </div>
                                    {currentItem?.song?.cifra_content && currentItem.song.cifra_content.length > 0 ? (
                                        <Button type="button" variant="outline" size="sm" onClick={() => setCifraViewerOpen(true)}>
                                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                                            Expandir
                                        </Button>
                                    ) : null}
                                </div>

                                {currentItem?.song ? (
                                    currentItem.song.cifra_content && currentItem.song.cifra_content.length > 0 ? (
                                        <CifraPanel
                                            song={currentItem.song}
                                            heightClassName="h-[26rem] rounded-lg border bg-background"
                                            contentClassName="px-3 py-3 font-mono text-[12px] leading-5 text-foreground sm:text-[13px] sm:leading-6"
                                        />
                                    ) : (
                                        <div className="rounded-lg border bg-background px-3 py-6 text-sm text-muted-foreground">
                                            Cifra local não disponível para esta música.
                                        </div>
                                    )
                                ) : null}
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
                    </div>
                )}
            </main>

            <CifraViewer
                song={currentItem?.song ?? null}
                open={cifraViewerOpen}
                onOpenChange={setCifraViewerOpen}
            />
        </div>
    )
}

export default function RepertoirePlayerPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-background">
                    <Header />
                    <main className="container mx-auto p-4 sm:p-6">
                        <div className="rounded-xl border bg-muted/10 p-6 text-sm text-muted-foreground">
                            Carregando playlist...
                        </div>
                    </main>
                </div>
            }
        >
            <RepertoirePlayerContent />
        </Suspense>
    )
}
