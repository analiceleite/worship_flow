'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Song } from '@/lib/types'
import { songHasCifra } from '@/lib/cifra-storage'
import { CifraPdfViewer } from '@/components/cifra-pdf-viewer'
import { useIsMobile, isMobileViewportSync } from '@/hooks/use-mobile'
import { ExternalLink, Pause, Play, RotateCcw, X } from 'lucide-react'
import { DialogClose } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface CifraViewerProps {
    song: Song | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface CifraContentProps {
    song: Song
    className?: string
    pdfVariant?: 'embedded' | 'fullscreen'
}

interface CifraPanelProps {
    song: Song
    heightClassName?: string
    contentClassName?: string
}

const AUTOSCROLL_SECONDS_KEY = 'cifra-autoscroll-seconds-per-screen'
const DEFAULT_SECONDS_PER_SCREEN = 30

const chordRe = /([A-G](?:#{1,2}|b{1,2})?(?:m|maj|min|sus|add|dim|aug)?(?:\d+[A-Za-z+#-]*)?(?:\([^)]*\))?(?:\/[A-G](?:#{1,2}|b{1,2})?)?)(?=[\s,.;:!?\)\]\}]|$)/g

function isLikelyChordLine(line: string) {
    const regex = new RegExp(chordRe)
    const matches = [...line.matchAll(regex)]
    if (matches.length >= 2) return true
    if (matches.length === 1 && line.trim() === matches[0][0]) return true
    return false
}

function renderLine(line: string, lineIndex: number) {
    if (!isLikelyChordLine(line)) {
        return (
            <div key={lineIndex} className="whitespace-pre-wrap break-words">{line}</div>
        )
    }

    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    const regex = new RegExp(chordRe)

    while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            parts.push(
                <span key={`${lineIndex}-txt-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>
            )
        }
        parts.push(
            <span
                key={`${lineIndex}-chord-${match.index}`}
                className="font-semibold text-amber-700 dark:text-amber-300"
            >
                {match[0]}
            </span>
        )
        lastIndex = match.index + match[0].length
    }

    if (lastIndex < line.length) {
        parts.push(
            <span key={`${lineIndex}-tail`}>{line.slice(lastIndex)}</span>
        )
    }

    return (
        <div key={lineIndex} className="whitespace-pre-wrap break-words">{parts}</div>
    )
}

export function CifraContent({ song, className, pdfVariant = 'embedded' }: CifraContentProps) {
    if (song.cifra_pdf_path) {
        return (
            <CifraPdfViewer
                storagePath={song.cifra_pdf_path}
                variant={pdfVariant}
                className={cn('h-full w-full', className)}
            />
        )
    }

    if (song.cifra_content && song.cifra_content.length > 0) {
        return (
            <div className={className ?? 'px-3 py-3 font-mono text-[13px] leading-6 text-foreground sm:text-sm sm:leading-6'}>
                {song.cifra_content.map((line, idx) => renderLine(line, idx))}
            </div>
        )
    }

    return (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Cifra não disponível para esta música.
        </div>
    )
}

export function CifraPanel({ song, heightClassName, contentClassName }: CifraPanelProps) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const frameRef = useRef<number | null>(null)
    const lastTimestampRef = useRef<number | null>(null)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(false)
    const [secondsPerScreen, setSecondsPerScreen] = useState(DEFAULT_SECONDS_PER_SCREEN)

    const hasPdfCifra = Boolean(song.cifra_pdf_path)
    const hasTextCifra = Boolean(song.cifra_content && song.cifra_content.length > 0)
    const hasCifra = songHasCifra(song)

    const speedLabel = useMemo(() => {
        if (secondsPerScreen === 1) return '1 segundo por tela'
        return `${secondsPerScreen} segundos por tela`
    }, [secondsPerScreen])

    const getViewport = () => {
        if (!rootRef.current) return null
        
        // Try primary selector first
        let element = rootRef.current.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
        if (element && element.scrollHeight > element.clientHeight) return element
        
        // Fallback: find first descendant with scrollable content
        const allDivs = rootRef.current.querySelectorAll('div')
        for (const div of allDivs) {
            const el = div as HTMLElement
            if (el.scrollHeight > el.clientHeight && el.style.overflow?.includes('auto')) {
                return el
            }
        }
        
        // Last resort: return first div with overflow
        for (const div of allDivs) {
            const el = div as HTMLElement
            if (el.scrollHeight > el.clientHeight + 1) {
                return el
            }
        }
        
        return null
    }

    const stopAutoScroll = () => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current)
            frameRef.current = null
        }
        lastTimestampRef.current = null
    }

    const resetScroll = () => {
        // Stop auto-scroll first
        setAutoScrollEnabled(false)
        stopAutoScroll()
        
        const viewport = getViewport()
        if (!viewport) return
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            viewport.scrollTop = 0
        })
    }

    useEffect(() => {
        const saved = window.localStorage.getItem(AUTOSCROLL_SECONDS_KEY)
        if (!saved) return

        const parsed = Number(saved)
        if (Number.isNaN(parsed)) return

        setSecondsPerScreen(Math.min(300, Math.max(5, parsed)))
    }, [])

    useEffect(() => {
        window.localStorage.setItem(AUTOSCROLL_SECONDS_KEY, String(secondsPerScreen))
    }, [secondsPerScreen])

    useEffect(() => {
        setAutoScrollEnabled(false)
        stopAutoScroll()
        const timeoutId = window.setTimeout(() => {
            const viewport = getViewport()
            viewport?.scrollTo({ top: 0, behavior: 'auto' })
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [song.id])

    useEffect(() => {
        if (!autoScrollEnabled || !hasCifra) {
            stopAutoScroll()
            return
        }

        // Reset timestamp when starting or when secondsPerScreen changes
        lastTimestampRef.current = null

        const step = (timestamp: number) => {
            const viewport = getViewport()
            if (!viewport) {
                frameRef.current = window.requestAnimationFrame(step)
                return
            }

            if (lastTimestampRef.current === null) {
                lastTimestampRef.current = timestamp
            }

            // Calculate scroll based on total elapsed time, not delta
            // This avoids floating-point truncation with large secondsPerScreen values
            const elapsedMs = timestamp - lastTimestampRef.current
            const scrollDurationMs = secondsPerScreen * 1000
            const maxScroll = viewport.scrollHeight - viewport.clientHeight
            const progress = Math.min(1, elapsedMs / scrollDurationMs)
            viewport.scrollTop = progress * maxScroll

            const reachedBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2
            if (reachedBottom) {
                setAutoScrollEnabled(false)
                stopAutoScroll()
                return
            }

            frameRef.current = window.requestAnimationFrame(step)
        }

        frameRef.current = window.requestAnimationFrame(step)

        return stopAutoScroll
    }, [autoScrollEnabled, hasCifra, secondsPerScreen, song.id])

    useEffect(() => stopAutoScroll, [])

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            {hasTextCifra ? (
                <div className="flex shrink-0 flex-col gap-3 rounded-md border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Autorrolagem</p>
                        <p className="text-xs text-muted-foreground">Configure o tempo e deixe a cifra descer sozinha.</p>
                    </div>

                    <div className="flex flex-col gap-3 sm:items-end">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant={autoScrollEnabled ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setAutoScrollEnabled((current) => !current)}
                            >
                                {autoScrollEnabled ? (
                                    <Pause className="mr-1.5 h-3.5 w-3.5" />
                                ) : (
                                    <Play className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                {autoScrollEnabled ? 'Pausar' : 'Iniciar'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={resetScroll}>
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                Reiniciar
                            </Button>
                        </div>

                        <div className="flex w-full items-center gap-2 sm:w-72">
                            <span className="shrink-0 text-xs text-muted-foreground">Tempo</span>
                            <input
                                type="range"
                                min={5}
                                max={300}
                                step={1}
                                value={secondsPerScreen}
                                onChange={(event) => setSecondsPerScreen(Number(event.target.value))}
                                aria-label="Tempo da autorrolagem da cifra"
                                title="Tempo da autorrolagem da cifra"
                                className="h-2 w-full cursor-pointer accent-emerald-500"
                            />
                            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{speedLabel}</span>
                        </div>
                    </div>
                </div>
            ) : null}

            <div ref={rootRef} className="min-h-0 flex-1">
                {hasPdfCifra ? (
                    <div
                        className={cn(
                            'h-full min-h-[min(70dvh,28rem)] lg:min-h-[min(75dvh,36rem)] xl:min-h-[min(80dvh,42rem)]',
                            heightClassName
                        )}
                    >
                        <CifraContent song={song} pdfVariant="embedded" className="h-full" />
                    </div>
                ) : (
                    <ScrollArea className={heightClassName ?? 'h-full rounded-md border bg-muted/40'}>
                        <CifraContent
                            song={song}
                            className={contentClassName ?? 'px-3 py-3 font-mono text-[13px] leading-6 text-foreground sm:text-sm sm:leading-6'}
                        />
                    </ScrollArea>
                )}
            </div>
        </div>
    )
}

export function CifraViewer({ song, open, onOpenChange }: CifraViewerProps) {
    const pdfSheetRef = useRef<HTMLDivElement | null>(null)
    const isMobile = useIsMobile()

    /** Desktop: navegador fullscreen (F11-par) em cima do painel PDF; falha silenciosamente se o browser bloquear. */
    useLayoutEffect(() => {
        if (!open || !song?.cifra_pdf_path) return
        if (isMobileViewportSync()) return

        let cancelled = false

        const run = async () => {
            const el = pdfSheetRef.current
            if (!el || cancelled) return
            const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => void }
            try {
                await el.requestFullscreen()
            } catch {
                try {
                    anyEl.webkitRequestFullscreen?.()
                } catch {
                    /* CSS fullscreen continua ativo */
                }
            }
        }

        const id = window.requestAnimationFrame(() => {
            void run()
        })

        return () => {
            cancelled = true
            window.cancelAnimationFrame(id)
            const el = pdfSheetRef.current
            if (el && document.fullscreenElement === el) {
                void document.exitFullscreen().catch(() => {})
            }
        }
    }, [open, song?.cifra_pdf_path, song?.id])

    if (!song) return null

    const hasPdfCifra = Boolean(song.cifra_pdf_path)
    const hasTextCifra = Boolean(song.cifra_content && song.cifra_content.length > 0)

    const capoFrets = typeof song.capo_frets === 'number'
        ? song.capo_frets
        : typeof (song as any)?.capo === 'number'
            ? (song as any).capo
            : null

    if (hasPdfCifra) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    ref={pdfSheetRef}
                    showCloseButton={false}
                    className={cn(
                        'fixed inset-0 left-0 top-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen min-w-0 max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none',
                        isMobile && 'pb-[env(safe-area-inset-bottom)]'
                    )}
                >
                    <header
                        className={cn(
                            'flex shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 backdrop-blur-sm',
                            isMobile ? 'px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]' : 'px-4 py-2.5 sm:px-5 sm:py-3'
                        )}
                    >
                        <div className="min-w-0 flex-1">
                            <DialogTitle
                                className={cn(
                                    'truncate text-left leading-tight',
                                    isMobile ? 'text-base' : 'text-lg sm:text-xl'
                                )}
                            >
                                {song.title}
                            </DialogTitle>
                            <p
                                className={cn(
                                    'truncate text-muted-foreground',
                                    isMobile ? 'text-xs' : 'text-sm'
                                )}
                            >
                                {song.artist}
                            </p>
                            <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                                Esc para fechar · zoom e links na barra do PDF abaixo
                            </p>
                        </div>
                        <DialogClose asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 shrink-0 rounded-full"
                                aria-label="Fechar cifra"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </DialogClose>
                    </header>
                    <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-950">
                        <CifraContent song={song} pdfVariant="fullscreen" className="min-h-0 flex-1" />
                    </div>
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'flex max-h-[92dvh] flex-col p-3 sm:p-5',
                    isMobile ? 'h-[100dvh] max-h-[100dvh] w-full max-w-none' : 'h-[94dvh] w-[min(96vw,1100px)] max-w-[1100px]'
                )}
            >
                <DialogHeader className="shrink-0">
                    <div className="flex items-start justify-between gap-3 pr-8">
                        <div className="min-w-0">
                            <DialogTitle className="truncate text-lg">{song.title}</DialogTitle>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">{song.artist}</p>
                        </div>
                        {hasTextCifra ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="mt-0.5 shrink-0 font-mono text-xs">
                                    {song.tone}
                                </Badge>
                                {capoFrets && capoFrets > 0 ? (
                                    <Badge variant="outline" className="mt-0.5 shrink-0 text-xs">
                                        Capo: {capoFrets}ª casa
                                    </Badge>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    {song.cipher_url && (
                        <div className="mt-2">
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
                                <a href={song.cipher_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="mr-1.5 h-3 w-3" />
                                    Abrir no CifraClub
                                </a>
                            </Button>
                        </div>
                    )}
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-hidden">
                    <CifraPanel song={song} heightClassName="h-full rounded-md border bg-muted/40" />
                </div>
            </DialogContent>
        </Dialog>
    )
}
